const mongoose = require('mongoose');

const TimerSchema = new mongoose.Schema({
  roomId: String,
  timerId: String,
  count: Number,
  note: String,
  isRunning: Boolean
});

module.exports = mongoose.model('Timer', TimerSchema);
//他のファイルでこのモデルがスキーマモデルが使えるようにエクスポートしてる。
//ちなみに第一引数の'Timer'は、sがついた状態でDBのコレクション名として使われる。
//今回は'Timer'としているので、'timers'というコレクションが生成される。

//ちなみにTimerSchemaとmongoose.modelしたあとのデータの構造は大きく違っていて、
//mongoose.modelしたあとは、クラスっぽいデータになってて、
//いろいろなメソッドなどが追加されているクラスとなる。