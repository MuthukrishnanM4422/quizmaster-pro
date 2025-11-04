const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state storage
const games = new Map();
const players = new Map();

// Healthcare Questions
const healthcareQuestions = [
  {
    text: "HIPAA stands for:",
    options: [
      "Health Insurance Portability and Accountability Act",
      "Health Information Privacy and Access Agreement",
      "Health Insurance Policy Administration Act",
      "Health Information Processing and Analysis Act"
    ],
    correctAnswer: 1,
    category: "healthcare"
  },
  {
    text: "What is the purpose of CPT codes?",
    options: [
      "To identify medical diagnoses",
      "To describe medical procedures and services",
      "To record patient demographics",
      "To manage insurance claims only"
    ],
    correctAnswer: 2,
    category: "healthcare"
  }
  // Add all 15 healthcare questions here...
];

// IT Questions
const itQuestions = [
  {
    text: "Which of the following is hardware?",
    options: [
      "Microsoft Word",
      "Keyboard",
      "Windows 11",
      "Chrome browser"
    ],
    correctAnswer: 2,
    category: "it"
  },
  {
    text: "Which of these is an operating system?",
    options: [
      "Oracle",
      "Google",
      "Linux",
      "Excel"
    ],
    correctAnswer: 3,
    category: "it"
  }
  // Add all 15 IT questions here...
];

// Combine all questions
const allQuestions = [...healthcareQuestions, ...itQuestions];

// Generate unique game code
function generateGameCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  // Ensure code is unique
  if (games.has(code)) {
    return generateGameCode();
  }
  return code;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create a new game
  socket.on('create-game', (data) => {
    const gameCode = generateGameCode();
    const game = {
      code: gameCode,
      host: socket.id,
      players: [],
      questions: [...allQuestions],
      currentQuestionIndex: -1,
      currentQuestion: null,
      timer: 20,
      scores: {},
      questionActive: false,
      playerAnswers: new Map(),
      gameStarted: false,
      gameEnded: false
    };
    
    games.set(gameCode, game);
    players.set(socket.id, { gameCode, playerName: data.hostName, isHost: true });
    
    socket.join(gameCode);
    socket.emit('game-created', { gameCode, game });
    
    console.log(`Game created: ${gameCode} by ${data.hostName}`);
  });

  // Join existing game
  socket.on('join-game', (data) => {
    const { gameCode, playerName } = data;
    const game = games.get(gameCode);
    
    if (!game) {
      socket.emit('join-error', 'Game not found');
      return;
    }
    
    if (game.gameStarted) {
      socket.emit('join-error', 'Game has already started');
      return;
    }
    
    // Add player to game
    const player = { id: socket.id, name: playerName, score: 0 };
    game.players.push(player);
    game.scores[playerName] = 0;
    
    players.set(socket.id, { gameCode, playerName, isHost: false });
    socket.join(gameCode);
    
    // Notify all players in the game
    io.to(gameCode).emit('player-joined', game.players);
    io.to(gameCode).emit('game-update', game);
    
    console.log(`Player ${playerName} joined game ${gameCode}`);
  });

  // Start the game
  socket.on('start-game', (gameCode) => {
    const game = games.get(gameCode);
    if (game && game.host === socket.id) {
      game.gameStarted = true;
      game.currentQuestionIndex = 0;
      game.currentQuestion = game.questions[0];
      
      io.to(gameCode).emit('game-started', game);
      io.to(gameCode).emit('game-update', game);
      
      console.log(`Game ${gameCode} started`);
    }
  });

  // Start a question
  socket.on('start-question', (gameCode) => {
    const game = games.get(gameCode);
    if (game && game.host === socket.id && !game.questionActive) {
      game.questionActive = true;
      game.playerAnswers.clear();
      game.timer = 20;
      
      // Start timer on server
      const timerInterval = setInterval(() => {
        game.timer--;
        
        io.to(gameCode).emit('timer-update', game.timer);
        
        if (game.timer <= 0) {
          clearInterval(timerInterval);
          game.questionActive = false;
          calculateScores(game);
          io.to(gameCode).emit('question-ended', game);
          io.to(gameCode).emit('game-update', game);
        }
      }, 1000);
      
      io.to(gameCode).emit('question-started', game);
      io.to(gameCode).emit('game-update', game);
    }
  });

  // Player submits answer
  socket.on('submit-answer', (data) => {
    const { gameCode, answer } = data;
    const game = games.get(gameCode);
    const player = players.get(socket.id);
    
    if (game && game.questionActive && player) {
      game.playerAnswers.set(player.playerName, answer);
      
      // Notify host about answer submission
      socket.to(game.host).emit('player-answered', {
        playerName: player.playerName,
        answer: answer
      });
    }
  });

  // Next question
  socket.on('next-question', (gameCode) => {
    const game = games.get(gameCode);
    if (game && game.host === socket.id) {
      game.currentQuestionIndex++;
      
      if (game.currentQuestionIndex >= game.questions.length) {
        // End game
        game.gameEnded = true;
        io.to(gameCode).emit('game-ended', game);
      } else {
        game.currentQuestion = game.questions[game.currentQuestionIndex];
        io.to(gameCode).emit('next-question', game);
      }
      
      io.to(gameCode).emit('game-update', game);
    }
  });

  // End game
  socket.on('end-game', (gameCode) => {
    const game = games.get(gameCode);
    if (game && game.host === socket.id) {
      game.gameEnded = true;
      io.to(gameCode).emit('game-ended', game);
      io.to(gameCode).emit('game-update', game);
    }
  });

  // Reset game
  socket.on('reset-game', (gameCode) => {
    const game = games.get(gameCode);
    if (game && game.host === socket.id) {
      // Reset game state but keep players
      game.currentQuestionIndex = -1;
      game.currentQuestion = null;
      game.gameStarted = false;
      game.gameEnded = false;
      game.scores = {};
      game.players.forEach(player => {
        game.scores[player.name] = 0;
      });
      
      io.to(gameCode).emit('game-reset', game);
      io.to(gameCode).emit('game-update', game);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      const game = games.get(player.gameCode);
      if (game) {
        if (player.isHost) {
          // Host disconnected - end game for everyone
          io.to(player.gameCode).emit('host-disconnected');
          games.delete(player.gameCode);
        } else {
          // Player disconnected - remove from game
          game.players = game.players.filter(p => p.id !== socket.id);
          delete game.scores[player.playerName];
          
          io.to(player.gameCode).emit('player-left', game.players);
          io.to(player.gameCode).emit('game-update', game);
        }
      }
      players.delete(socket.id);
    }
    
    console.log('User disconnected:', socket.id);
  });
});

// Calculate scores for current question
function calculateScores(game) {
  const correctAnswer = game.currentQuestion.correctAnswer;
  
  game.playerAnswers.forEach((answer, playerName) => {
    if (answer === correctAnswer) {
      game.scores[playerName] = (game.scores[playerName] || 0) + 10;
    }
  });
  
  // Update player objects with scores
  game.players.forEach(player => {
    player.score = game.scores[player.name] || 0;
  });
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Access the game at: http://localhost:${PORT}`);
});