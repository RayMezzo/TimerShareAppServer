//---サーバーサイド---

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const TimerModel = require('./models/Timer');


require("dotenv").config();

const app = express();
// 🌟 環境変数から FRONTEND_URL を取得
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Socket.IO に CORS 設定を追加
const io = new Server(server, {
  cors: {
    origin: FRONTEND_URL,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  },
});

// ✅ これは socket.io の CORS 設定とは別に Express 側にも CORS ヘッダーをつける例
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND_URL);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

mongoose.connect(
  process.env.MONGODB_URI
)
.then(() => console.log("db connected"))
.catch((err) => console.log(err));

//Mongooseをつなげるためのコード。
//process.env.MONGODB_URIには、MongoDBに接続するためのURIが入ってる。
//.thenは.connectが終わった後に始まる処理。
//ちなみに.connectはPromiseを返してる。

const roomTimers = {}; // { roomId: { nextTimerId: 1, timers: { [timerId]: { count, interval, note } } } }
//#region
// roomTimersの構造
// const roomTimers = {
//   [roomId]: {
//     timers: {
//       [timerId]: {
//         count: Number,
//         interval: IntervalObject, // ← これは setInterval() の戻り値なので送れない
//         note: String
//       },
//       ...
//     }
//   },
//   ...
// }

//例:
// const roomTimers = {
//   "room123": {
//     timers: {
//       "timer1": {
//         count: 42,
//         interval: setInterval(...),  // ⚠️ JSONにできない！
//         note: "休憩タイマー"
//       },
//       "timer2": {
//         count: 100,
//         interval: setInterval(...),
//         note: "勉強タイマー"
//       }
//     }
//   },
//   "room456": {
//     timers: {
//       "timerA": {
//         count: 0,
//         interval: setInterval(...),
//         note: "別ルーム用タイマー"
//       }
//     }
//   }
// }
//#endregion




io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  //まずはio.onですべてのクライアントのデータをsocketとして取得する。
  //socket.idはクライアントがコネクトしたときに自動的に割り振られるもので、ユニークなidが割り振られる。
  //後々、特定のclientに対して、データを送信するなどができるようにidを割り振ってる。


  //---ルーム参加処理----
  socket.on('join_room', async(roomId) => {
    socket.join(roomId);
    console.log(`Client ${socket.id} joined room ${roomId}`);

    //roomIdの部屋に入る。

    if (!roomTimers[roomId]) {
      roomTimers[roomId] = {
        nextTimerId: 1,
        timers: {},
      };
    }
    //roomTimersのなかにそのroomIdプロパティがなければ作る。
    //ちなみに、オブジェクトのプロパティ呼び出しはroomTimers.roomIdとかでも行けると思われがちだけど、
    //プロパティ名が変数のときはブラケット記法を使わなくてはいけないらしい。roomTimers[roomId]こういうやつ。
    //プロパティ名が固定のときだけドット記法が使える。roomTimers.roomIdこういうやつ。

    // ルームに存在するタイマーの情報を送信
    const timers = roomTimers[roomId].timers;
    // 修正：循環参照のない安全なデータだけ送る
    socket.emit('all_timers', Object.entries(timers).map(([timerId, timer]) => ({
      
      timerId,
      count: timer.count,
      isRunning: timer.isRunning, // 必要なら現在の状態も送れる
      note: timer.note || ''
      
    })));

  });

  socket.on('leave_room', (roomId) => {
    socket.leave(roomId);
    console.log(`Client ${socket.id} left room ${roomId}`);
  });

  socket.on('create_timer', async({ roomId }) => {
    const room = roomTimers[roomId];
    if (!room) return;

    const timerId = room.nextTimerId.toString();
    room.nextTimerId++;

    const newTimer = {
      count: 0,
      interval: null,
      note: '',
    };
  
    room.timers[timerId] = newTimer;

    // MongoDBに保存
    await TimerModel.create({
      roomId,
      timerId,
      count: 0,
      note: '',
      isRunning: false
    });

    // タイマー作成時には他のクライアントに通知
    io.to(roomId).emit('timer_created', { timerId, count: 0, note: '' });
  });

  socket.on('resume_timer', async({ roomId, timerId }) => {
    const timer = roomTimers[roomId]?.timers[timerId];
    if (!timer || timer.interval) return;

    

    timer.interval = setInterval(() => {
      timer.count += 0.1;
      //console.log(`Timer ${timerId} running: ${timer.count.toFixed(1)}s`);
      io.to(roomId).emit('timer_update', { timerId, count: timer.count });
    }, 100);

    

    timer.isRunning = true;

    // MongoDB に isRunning: true を保存
    try {
      await TimerModel.findOneAndUpdate(
        { roomId, timerId },
        { isRunning: true },
        { upsert: true }
      );
      console.log(`Timer ${timerId} in room ${roomId} marked as running in DB`);
    } catch (err) {
      console.error(`Failed to update isRunning for timer ${timerId}:`, err);
    }

    io.to(roomId).emit('timer_status', { timerId, isRunning: true });
  });


  //--タイマーを停止する処理-----------------
  socket.on('stop_timer', async({ roomId, timerId }) => {
    const timer = roomTimers[roomId]?.timers[timerId];
    if (!timer) {
      console.log(`[stop_timer] タイマーが見つかりません: roomId=${roomId}, timerId=${timerId}`);
      return;
    }
  
    if (!timer.interval) {
      console.log(`[stop_timer] intervalが存在しないため停止処理スキップ: roomId=${roomId}, timerId=${timerId}, isRunning=${timer.isRunning}`);
      return;
    }

    clearInterval(timer.interval);
    timer.interval = null;
    timer.isRunning = false;

      // --- 追加: MongoDBに保存 ---
  try {
    console.log(`保存直前のタイマーの値  :  ${timer.count.toFixed(1)} `);
    await TimerModel.findOneAndUpdate(
      { roomId, timerId },
      {
        count: timer.count,
        isRunning: false,
      },
      { upsert: true } // ドキュメントが無い場合は新規作成
    );
    console.log(`タイマーが停止しました。isRunning=${timer.isRunning}`);
    console.log(`${roomId}の${timerId} がＤＢにセーブされました。`);
    console.log(`タイマーの値  :  ${timer.count.toFixed(1)} `);

    

  } catch (err) {
    console.error(`Failed to save timer:`, err);
  }


    io.to(roomId).emit('timer_status', { timerId, isRunning: false });
  });

  socket.on('reset_timer', async({ roomId, timerId }) => {
    const timer = roomTimers[roomId]?.timers[timerId];
    if (!timer) return;
    timer.count = 0;


    // --- 追加: MongoDBに保存 ---
  try {
    await TimerModel.findOneAndUpdate(
      { roomId, timerId },
      {
        count: 0,
        isRunning: false, // リセット時は止まってる前提で false にする
      },
      { upsert: true }
    );
      console.log(`Timer ${timerId} in room ${roomId} reset and saved to DB`);
    } catch (err) {
      console.error(`Failed to save reset timer:`, err);
    }

    io.to(roomId).emit('timer_update', { timerId, count: 0 });
  });

  socket.on('delete_timer', async({ roomId, timerId }) => {
    const timer = roomTimers[roomId]?.timers[timerId];
    if (!timer) return;
  
    clearInterval(timer.interval);
    delete roomTimers[roomId].timers[timerId];
  
    await TimerModel.deleteOne({ roomId, timerId });
    io.to(roomId).emit('timer_deleted', timerId);
  });

  // メモを更新するイベント
  socket.on('update_note', async({ roomId, timerId, note }) => {
    const timer = roomTimers[roomId]?.timers[timerId];
    //これはオプショナルチェイニングっていって、
    //undefindの場合でも、エラーにならないようにするやつらしい。
    //roomidやtimerIdが無くてもundefinedが返るだけになる。
    //そして、timerがundefinedならreturn。
    if (!timer) return;

    timer.note = note;
    //noteを更新。

    
    await TimerModel.updateOne({ roomId, timerId }, { note });
    

    // メモが変更された場合のみ、他のクライアントに通知
    io.to(roomId).emit('note_updated', { timerId, note });
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Socket.IO server running on http://localhost:${PORT}`);
});
