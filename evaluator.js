/**
 * 株札ポーカー 役判定エンジン (evaluator.js)
 */

// 役の定数定義（数値が大きいほど強い）
const HAND_TYPES = {
  ZORO_10: 19, // 10.10 ゾロ目
  ZORO_9: 18,
  ZORO_8: 17,
  ZORO_7: 16,
  ZORO_6: 15,
  ZORO_5: 14,
  ZORO_4: 13,
  ZORO_3: 12,
  ZORO_2: 11,
  ZORO_1: 10,  // 1.1 ゾロ目
  TOPPIN: 9,   // 10.1
  KUPPIN: 8,   // 9.1
  SHIPPIN: 7,  // 4.1
  POINTS_9: 6, // 9点
  POINTS_8: 5,
  POINTS_7: 4,
  POINTS_6: 3,
  POINTS_5: 2,
  POINTS_4: 1,
  POINTS_3: 0, // ※1.2 は通常ここ（3点）
  POINTS_2: -1,
  POINTS_1: -2,
  POINTS_0: -3  // 0点（最弱）
};

// 役名（日本語）
const HAND_NAMES = {
  [HAND_TYPES.ZORO_10]: "じゅんじゅん (10.10)",
  [HAND_TYPES.ZORO_9]: "九ゾロ (9.9)",
  [HAND_TYPES.ZORO_8]: "八ゾロ (8.8)",
  [HAND_TYPES.ZORO_7]: "七ゾロ (7.7)",
  [HAND_TYPES.ZORO_6]: "六ゾロ (6.6)",
  [HAND_TYPES.ZORO_5]: "五ゾロ (5.5)",
  [HAND_TYPES.ZORO_4]: "四ゾロ (4.4)",
  [HAND_TYPES.ZORO_3]: "三ゾロ (3.3)",
  [HAND_TYPES.ZORO_2]: "二ゾロ (2.2)",
  [HAND_TYPES.ZORO_1]: "ピンピン (1.1)",
  [HAND_TYPES.TOPPIN]: "とっぴん (10.1)",
  [HAND_TYPES.KUPPIN]: "くっピン (9.1)",
  [HAND_TYPES.SHIPPIN]: "しっぴん (4.1)",
  [HAND_TYPES.POINTS_9]: "九点 (カブ)",
  [HAND_TYPES.POINTS_8]: "八点 (オイチョ)",
  [HAND_TYPES.POINTS_7]: "七点 (ナキ)",
  [HAND_TYPES.POINTS_6]: "六点 (ロッポウ)",
  [HAND_TYPES.POINTS_5]: "五点 (ゴケ)",
  [HAND_TYPES.POINTS_4]: "四点 (ヨツ)",
  [HAND_TYPES.POINTS_3]: "三点 (サンタ)",
  [HAND_TYPES.POINTS_2]: "二点 (ニタ)",
  [HAND_TYPES.POINTS_1]: "一点 (ピン)",
  [HAND_TYPES.POINTS_0]: "ブタ (0点)"
};

/**
 * 手札を評価する
 * @param {number[]} hand - [card1, card2] の配列 (1〜10)
 * @returns {object} { type: HAND_TYPES, name: string, cards: number[] }
 */
function evaluateHand(hand) {
  if (!hand || hand.length !== 2) {
    throw new Error("手札は2枚である必要があります");
  }

  // 昇順にソート
  const cards = [...hand].sort((a, b) => a - b);
  const [c1, c2] = cards;

  // 1. ゾロ目の判定
  if (c1 === c2) {
    const type = HAND_TYPES.ZORO_1 + (c1 - 1);
    return {
      type,
      name: HAND_NAMES[type],
      cards
    };
  }

  // 2. 特殊役（しっぴん、くっぴん、とっぴん）の判定
  // しっぴん: 1と4
  if (c1 === 1 && c2 === 4) {
    return {
      type: HAND_TYPES.SHIPPIN,
      name: HAND_NAMES[HAND_TYPES.SHIPPIN],
      cards
    };
  }
  // くっぴん: 1と9
  if (c1 === 1 && c2 === 9) {
    return {
      type: HAND_TYPES.KUPPIN,
      name: HAND_NAMES[HAND_TYPES.KUPPIN],
      cards
    };
  }
  // とっぴん: 1と10
  if (c1 === 1 && c2 === 10) {
    return {
      type: HAND_TYPES.TOPPIN,
      name: HAND_NAMES[HAND_TYPES.TOPPIN],
      cards
    };
  }

  // 3. 通常の点数（合計の一桁目）
  const sum = c1 + c2;
  const points = sum % 10;
  const type = HAND_TYPES.POINTS_0 + points;

  return {
    type,
    name: HAND_NAMES[type],
    cards
  };
}

/**
 * 複数の生存プレイヤーの手札を比較し、勝者を決定する
 * @param {object[]} players - プレイヤーオブジェクトの配列。各オブジェクトは { id, hand: number[] } を含む
 * @returns {object} { winners: string[], details: object }
 */
function determineWinners(players) {
  if (!players || players.length === 0) {
    return { winners: [], details: {} };
  }

  // 各プレイヤーの手札を評価
  const evaluatedPlayers = players.map(p => {
    const evaluation = evaluateHand(p.hand);
    return {
      id: p.id,
      name: p.name,
      hand: p.hand,
      evaluation,
      // 1.2 (c1=1, c2=2) の判定フラグ
      is1_2: (Math.min(...p.hand) === 1 && Math.max(...p.hand) === 2),
      // 10.10 ゾロ目の判定フラグ
      is10_10: (p.hand[0] === 10 && p.hand[1] === 10)
    };
  });

  // 場に 10.10 と 1.2 が同時に存在するかどうかをチェック
  const has10_10 = evaluatedPlayers.some(p => p.is10_10);
  const has1_2 = evaluatedPlayers.some(p => p.is1_2);

  // 10.10キラーの特殊相性が発動する場合
  const killerTriggered = has10_10 && has1_2;

  // 各プレイヤーの「有効ランク」を計算
  const scoredPlayers = evaluatedPlayers.map(p => {
    let effectiveScore = p.evaluation.type;
    let customName = p.evaluation.name;

    if (killerTriggered) {
      if (p.is1_2) {
        // 1.2 は 10.10 を超える最強スコアに化ける
        effectiveScore = HAND_TYPES.ZORO_10 + 1;
        customName = "10.10キラー (1.2)";
      } else if (p.is10_10) {
        // 10.10 は 1.2 に敗北するため、最弱にする
        effectiveScore = HAND_TYPES.POINTS_0 - 1;
        customName = "10.10 (キラー撃破)";
      }
    }

    return {
      ...p,
      effectiveScore,
      customName
    };
  });

  // 最高スコアを見つける
  let maxScore = -Infinity;
  scoredPlayers.forEach(p => {
    if (p.effectiveScore > maxScore) {
      maxScore = p.effectiveScore;
    }
  });

  // 最高スコアを持つプレイヤー（引き分けの可能性あり）
  const winners = scoredPlayers
    .filter(p => p.effectiveScore === maxScore)
    .map(p => p.id);

  return {
    winners,
    players: scoredPlayers.map(p => ({
      id: p.id,
      name: p.name,
      hand: p.hand,
      evaluatedName: p.customName,
      score: p.effectiveScore,
      isWinner: winners.includes(p.id)
    })),
    killerTriggered
  };
}

// グローバルスコープへ公開
window.Evaluator = {
  HAND_TYPES,
  HAND_NAMES,
  evaluateHand,
  determineWinners
};

