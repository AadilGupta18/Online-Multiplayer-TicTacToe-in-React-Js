// import { createServer } from "http";
// import { Server } from "socket.io";

const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: "http://localhost:5173/",
});

const allUsers = {};
const allRooms = [];

io.on("connection", (socket) => {
  allUsers[socket.id] = {
    socket: socket,
    online: true,
  };

  socket.on("request_to_play", (data) => {
    const currentUser = allUsers[socket.id];
    currentUser.playerName = data.playerName;

    let opponentPlayer;

    for (const key in allUsers) {
      const user = allUsers[key];
      if (user.online && !user.playing && socket.id !== key) {
        opponentPlayer = user;
        break;
      }
    }

    if (opponentPlayer) {
      // mark users as playing and store initial playingAs
      opponentPlayer.playing = true;
      currentUser.playing = true;
      opponentPlayer.playingAs = "cross";
      currentUser.playingAs = "circle";

      // create room and keep rematch flags per-socket
      const room = {
        player1: opponentPlayer,
        player2: currentUser,
        rematch: {
          [opponentPlayer.socket.id]: false,
          [currentUser.socket.id]: false,
        },
        // track who started last (the socket id). default: currentUser (who got circle)
        lastStarterSocketId: currentUser.socket.id,
      };

      allRooms.push(room);

      opponentPlayer.socket.emit("OpponentFound", {
        opponentName: currentUser.playerName,
        playingAs: opponentPlayer.playingAs,
      });

      currentUser.socket.emit("OpponentFound", {
        opponentName: opponentPlayer.playerName,
        playingAs: currentUser.playingAs,
      });

      // proxy moves between the two sockets
      currentUser.socket.on("playerMoveFromClient", (data) => {
        opponentPlayer.socket.emit("playerMoveFromServer", {
          ...data,
        });
      });

      opponentPlayer.socket.on("playerMoveFromClient", (data) => {
        currentUser.socket.emit("playerMoveFromServer", {
          ...data,
        });
      });

      // helper to handle rematch requests
      const handleRematch = (playerSocket, data) => {
        const foundRoom = allRooms.find(
          (r) =>
            r.player1.socket.id === playerSocket.id ||
            r.player2.socket.id === playerSocket.id
        );
        if (!foundRoom) return;

        // mark this player's rematch request and update their playingAs if provided
        foundRoom.rematch[playerSocket.id] = true;
        if (data && data.playingAs) {
          if (foundRoom.player1.socket.id === playerSocket.id) {
            foundRoom.player1.playingAs = data.playingAs;
          } else {
            foundRoom.player2.playingAs = data.playingAs;
          }
        }

        const bothRequested = Object.values(foundRoom.rematch).every(Boolean);
        if (bothRequested) {
          // swap the playingAs values so players swap symbols
          const p1New = foundRoom.player2.playingAs;
          const p2New = foundRoom.player1.playingAs;

          foundRoom.player1.playingAs = p1New;
          foundRoom.player2.playingAs = p2New;

          // reset rematch flags
          foundRoom.rematch[foundRoom.player1.socket.id] = false;
          foundRoom.rematch[foundRoom.player2.socket.id] = false;

          const newState = [
            [1, 2, 3],
            [4, 5, 6],
            [7, 8, 9],
          ];

          // determine who should start this round by toggling lastStarterSocketId
          const prevStarter = foundRoom.lastStarterSocketId;
          let newStarterSocketId = foundRoom.player1.socket.id;
          if (prevStarter === foundRoom.player1.socket.id) {
            newStarterSocketId = foundRoom.player2.socket.id;
          }
          foundRoom.lastStarterSocketId = newStarterSocketId;

          // startingPlayer symbol for the round
          const startingPlayerSymbol =
            foundRoom.player1.socket.id === newStarterSocketId
              ? foundRoom.player1.playingAs
              : foundRoom.player2.playingAs;

          foundRoom.player1.socket.emit("rematchOrderFromServer", {
            playingAs: p1New,
            gameState: newState,
            startingPlayer: startingPlayerSymbol,
          });

          foundRoom.player2.socket.emit("rematchOrderFromServer", {
            playingAs: p2New,
            gameState: newState,
            startingPlayer: startingPlayerSymbol,
          });
        }
      };

      currentUser.socket.on("rematchRequestFromPlayer", (data) => {
        handleRematch(currentUser.socket, data);
      });

      opponentPlayer.socket.on("rematchRequestFromPlayer", (data) => {
        handleRematch(opponentPlayer.socket, data);
      });
    } else {
      currentUser.socket.emit("OpponentNotFound");
    }
  });

  socket.on("disconnect", function () {
    const currentUser = allUsers[socket.id];
    currentUser.online = false;
    currentUser.playing = false;

    for (let index = 0; index < allRooms.length; index++) {
      const { player1, player2 } = allRooms[index];

      if (player1.socket.id === socket.id) {
        player2.socket.emit("opponentLeftMatch");
        break;
      }

      if (player2.socket.id === socket.id) {
        player1.socket.emit("opponentLeftMatch");
        break;
      }
    }
  });
});

httpServer.listen(process.env.PORT || 3000);
