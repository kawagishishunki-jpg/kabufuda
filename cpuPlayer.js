/**
 * CPUプレイヤーの意思決定ロジック (cpuPlayer.js)
 */

/**
 * CPUのアクションを決定する
 * @param {object} params
 * @param {number[]} params.hand - CPUの手札
 * @param {number} params.currentBet - 現在のラウンドの最大ベット額
 * @param {number} params.myCurrentBet - CPUがこのラウンドで既にベットした額
 * @param {number} params.chips - CPUが所持している残チップ数
 * @param {number} params.pot - 現在のポットの合計チップ数
 * @param {number} params.round - 現在のベットラウンド (1, 2, 3)
 * @param {number} params.playersInGame - 生き残っているプレイヤーの総数
 * @param {number} params.aggression - CPUの性格パラメータ（0.0 〜 1.0、高いほどブラフやレイズを好む）
 * @returns {object} { action: 'fold' | 'call' | 'raise', amount: number }
 */
function decideCpuAction({
  hand,
  currentBet,
  myCurrentBet,
  chips,
  pot,
  round,
  playersInGame,
  aggression = 0.5
}) {
  const { evaluateHand, HAND_TYPES } = window.Evaluator;
  const evaluation = evaluateHand(hand);
  const type = evaluation.type;
  
  // コールに必要な額
  const callAmount = currentBet - myCurrentBet;
  
  if (chips <= 0) {
    return { action: "call", amount: 0 }; // チップがなければチェック/コール状態（オールイン）
  }

  // 1. 手札の基礎自信度（0.0〜1.0）
  let confidence = 0.0;

  if (type >= HAND_TYPES.ZORO_1) {
    // ゾロ目以上は最強クラス (0.85 〜 1.0)
    const zoroOffset = type - HAND_TYPES.ZORO_1; // 0〜9
    confidence = 0.85 + (zoroOffset / 9) * 0.15;
  } else if (type >= HAND_TYPES.SHIPPIN) {
    // 特殊役 (0.75 〜 0.82)
    const specialOffset = type - HAND_TYPES.SHIPPIN; // 0〜2
    confidence = 0.75 + (specialOffset / 2) * 0.07;
  } else {
    // 通常点数 0〜9 (0.1 〜 0.7)
    const points = type - HAND_TYPES.POINTS_0; // 0〜9
    confidence = 0.1 + (points / 9) * 0.6;
  }

  // 1.2 (10.10キラー) の特殊処理
  const is1_2 = (Math.min(...hand) === 1 && Math.max(...hand) === 2);
  if (is1_2) {
    // 1.2 は基本3点(confidence = 0.3)だが、相手がもの凄く強く張っている（10.10の可能性がある）場合、
    // あるいは一定確率でコールし続ける「キラーブラフ・トラップ」を仕掛ける
    // ラウンドが進むにつれてコールしやすくなる
    confidence = 0.25 + (round * 0.1); 
  }

  // 性格による自信度の補正
  confidence = confidence * (0.8 + aggression * 0.4);
  confidence = Math.min(1.0, Math.max(0.0, confidence));

  // 2. 意思決定のしきい値
  // ブラフの判定 (特に弱い手のとき、たまに強く出る)
  const isBluffing = (type <= HAND_TYPES.POINTS_3) && (Math.random() < (0.05 + aggression * 0.1));

  // レイズに必要な最小・最大額（1〜3チップ）
  const minRaise = 1;
  const maxRaise = Math.min(3, chips - callAmount);

  // コール額が手持ちチップを超える場合、強制的にオールイン（コール扱い）かフォールド
  if (callAmount >= chips) {
    // 自信度が非常に高い、またはブラフ中ならコール（オールイン）
    if (confidence > 0.6 || isBluffing) {
      return { action: "call", amount: chips };
    } else {
      return { action: "fold", amount: 0 };
    }
  }

  // 3. アクションの選択
  // 自信度またはブラフ状況に応じた分岐
  if (confidence > 0.75 || isBluffing) {
    // 非常に強い手、またはブラフ時：レイズ（上乗せ）
    if (maxRaise >= minRaise && Math.random() < 0.6) {
      // 1〜3チップのランダムな額をレイズ
      const raiseAmount = Math.floor(Math.random() * (maxRaise - minRaise + 1)) + minRaise;
      return { action: "raise", amount: callAmount + raiseAmount };
    } else {
      return { action: "call", amount: callAmount };
    }
  } else if (confidence > 0.35 || callAmount === 0) {
    // 普通以上の強さ、またはチェック可能な状態：コール
    return { action: "call", amount: callAmount };
  } else {
    // 弱い手かつベットされている場合：
    // ポットオッズを考慮（コール額に対してポットが大きいならコールしてみる）
    const potOdds = callAmount / (pot + callAmount);
    if (potOdds < 0.2 && Math.random() < 0.5) {
      return { action: "call", amount: callAmount };
    }
    // それ以外はフォールド
    return { action: "fold", amount: 0 };
  }
}

// グローバルスコープへ公開
window.decideCpuAction = decideCpuAction;

