const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Initialisiere Socket.io mit Polling und WebSocket-Fallback
const io = socketIo(server, {
    transports: ['polling', 'websocket'],  // WebSocket als Fallback, falls möglich
    allowEIO3: true  // Unterstützung für ältere Socket.io-Versionen
});

let players = [];
let currentTurnIndex = 0;
let totalValue = 0;
let lifeDeterminationPhase = true;
let roundActive = false;
let currentGameActive = true; // Variable für laufendes Spiel
let gameStats = {}; // Statistiken für gewonnene und verlorene Spiele

// Statische Dateien im 'public'-Ordner bereitstellen (falls nötig)
app.use(express.static(path.join(__dirname, 'public')));

// Route für die Hauptseite ("/"), um index.html zu laden
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Socket.io-Verbindung für Spieler
io.on('connection', (socket) => {
    console.log('Ein Spieler hat sich verbunden:', socket.id);

    socket.on('newPlayer', (playerName) => {
        if (playerName && players.findIndex(p => p.name === playerName) === -1) {
            const player = {
                id: socket.id,
                name: playerName,
                life: 0,
                isTurn: false,
                hasSacrificed: false,
                eliminated: false
            };

            if (!roundActive) {
                players.push(player);
                io.emit('logMessage', `${playerName} hat das Spiel betreten und wartet auf das nächste Spiel.`);
            } else {
                io.emit('logMessage', `${playerName} kann erst beim nächsten Spiel mitspielen.`);
            }

            gameStats[playerName] = { wins: 0, losses: 0 };
            io.emit('updateGameStats', gameStats);
            io.emit('updatePlayers', players);
        }
    });

    // Spieler würfelt sein Leben aus
    socket.on('determineLife', () => {
        if (lifeDeterminationPhase) {
            const player = players.find(p => p.id === socket.id);
            if (player && player.life === 0) {
                const lifeRoll = Math.floor(Math.random() * 6) + 1;
                player.life = lifeRoll;
                io.emit('logMessage', `${player.name} hat ${lifeRoll} Leben gewürfelt.`);
                io.emit('updatePlayers', players);

                if (players.every(p => p.life > 0)) {
                    lifeDeterminationPhase = false;
                    roundActive = true;

                    // Spieler nach Leben sortieren, der mit den wenigsten Leben beginnt
                    players.sort((a, b) => a.life - b.life);
                    currentTurnIndex = 0;
                    players[currentTurnIndex].isTurn = true;
                    io.emit('logMessage', `${players[0].name} beginnt das Spiel mit den wenigsten Leben.`);
                    io.emit('updatePlayers', players);
                }
            }
        }
    });

    // Spieler würfelt während des Spiels
    socket.on('rollDice', () => {
        const player = players[currentTurnIndex];
        if (player && player.id === socket.id && roundActive && !player.eliminated) {
            let roll = Math.floor(Math.random() * 6) + 1;
            let displayRoll = roll;
            if (roll === 3) {
                roll = 0;
            }

            totalValue += roll;

            let remaining = 16 - totalValue;
            let riskToLose = remaining < 6 ? (6 - remaining) / 6 : 0;

            io.emit('rollResult', {
                player: player.name,
                roll: displayRoll,
                totalValue: totalValue,
                riskToLose: (riskToLose * 100).toFixed(2) + "%"
            });

            io.emit('logMessage', `${player.name} hat eine ${displayRoll} gewürfelt. Aktueller Gesamtwert: ${totalValue}`);

            if (totalValue >= 16) {
                io.emit('playerEliminated', player.name);
                io.emit('logMessage', `${player.name} ist ausgeschieden.`);
                player.eliminated = true;
                gameStats[player.name].losses++;
                players.splice(currentTurnIndex, 1);
                totalValue = 0;

                if (players.length > 1) {
                    currentTurnIndex = currentTurnIndex % players.length;
                    players.forEach((p, index) => {
                        p.isTurn = index === currentTurnIndex;
                    });
                    io.emit('updatePlayers', players);
                } else {
                    io.emit('gameOver', players[0].name);
                    gameStats[players[0].name].wins++;
                    roundActive = false;
                    io.emit('updateGameStats', gameStats);
                }
            } else {
                currentTurnIndex = (currentTurnIndex + 1) % players.length;
                players.forEach((p, index) => {
                    p.isTurn = index === currentTurnIndex;
                });
                io.emit('updatePlayers', players);
            }
        }
    });

    // Spieler opfert ein Leben
    socket.on('sacrificeLife', () => {
        const player = players[currentTurnIndex];
        if (player && player.id === socket.id && roundActive && !player.eliminated) {
            if (player.life > 1) {
                player.life--;
                totalValue = 0;
                io.emit('lifeSacrificed', {
                    player: player.name,
                    life: player.life
                });
                io.emit('logMessage', `${player.name} hat ein Leben geopfert und startet bei 0. Verbleibende Leben: ${player.life}`);
                io.emit('updatePlayers', players);
            } else {
                io.emit('logMessage', `${player.name} kann kein Leben mehr opfern, da er nur noch 1 Leben hat.`);
            }
        }
    });

    // Spiel wird zurückgesetzt
    socket.on('newRound', () => {
        players.forEach(player => {
            player.life = 0;
            player.isTurn = false;
            player.hasSacrificed = false;
            player.eliminated = false;
        });

        currentTurnIndex = 0;
        totalValue = 0;
        lifeDeterminationPhase = true;
        roundActive = false;

        io.emit('resetGame');
        io.emit('logMessage', "Das Spiel wurde zurückgesetzt. Ein neues Spiel beginnt.");
    });

    // Chatnachricht empfangen
    socket.on('sendMessage', (message) => {
        io.emit('receiveMessage', message);
    });

    // Log-Nachrichten empfangen
    socket.on('logMessage', (message) => {
        io.emit('logMessage', message);
    });
});

// Server auf Port 3000 oder den von Render festgelegten Port starten
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server läuft auf Port ${PORT}`);
});
