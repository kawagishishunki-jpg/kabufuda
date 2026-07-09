// 起動時・実行時のエラー検知用ハンドラ
window.onerror = function(message, source, lineno, colno, error) {
  console.error("Uncaught error:", error);
  alert("【起動エラー】ゲーム開始中に問題が発生しました:\n" + message + "\n\nファイル: " + source.split('/').pop() + "\n行番号: " + lineno);
  return false;
};

const { evaluateHand, determineWinners, HAND_TYPES, HAND_NAMES } = window.Evaluator;
const decideCpuAction = window.decideCpuAction;
const PeerManager = window.PeerManager;

/**
 * 株ポーカー メインアプリケーション (app.js)
 */

// --- アプリケーション状態 (State) ---
const state = {
  mode: "lobby", // 'lobby' | 'waiting' | 'game'
  gameType: "cpu", // 'cpu' | 'online'
  myId: "",
  myName: "プレイヤー",
  roomCode: "",
  isHost: false,
  
  // プレイヤーリスト: { id, name, chips, hand, roundBet, totalBet, isFolded, isCpu, isHost }
  players: [],
  
  // ゲーム進行
  deck: [],
  pot: 0,
  currentBet: 0,      // 現在のベットラウンドでの最大ベット額
  betRound: 1,        // 1, 2, 3
  activePlayerIndex: 0,
  dealerIndex: 0,
  startingPlayerIndex: 0,
  lastAggressorIndex: -1, // 最後にレイズ（または最初のベット）したプレイヤー。ベット額一致確認用。
  actionCount: 0,       // ラウンド中のアクション回数（全員がアクションを1周したかの確認用）
  
  // お祝儀ルーレット用
  rouletteWinnerId: "",
  rouletteCardValue: 0,
  isTsuki: false,
  tsukiResults: null,
  tsukiGiftText: null
};

// --- 定数 ---
const INITIAL_CHIPS = 100;
const ANTE = 1; // 参加費

// --- DOM 要素 ---
const screens = {
  lobby: document.getElementById("lobby-screen"),
  waiting: document.getElementById("waiting-screen"),
  game: document.getElementById("game-screen")
};

const lobbyInputs = {
  name: document.getElementById("player-name-input"),
  joinCode: document.getElementById("join-room-input")
};

const lobbyButtons = {
  cpu: document.getElementById("btn-cpu-mode"),
  create: document.getElementById("btn-create-room"),
  join: document.getElementById("btn-join-room")
};

const waitingElems = {
  code: document.getElementById("room-code-display"),
  list: document.getElementById("waiting-players-list"),
  start: document.getElementById("btn-start-game"),
  leave: document.getElementById("btn-leave-waiting"),
  status: document.getElementById("waiting-status-text")
};

const gameElems = {
  pot: document.getElementById("pot-value"),
  roundText: document.getElementById("bet-round-text"),
  deckText: document.getElementById("deck-count-text"),
  log: document.getElementById("game-log"),
  myHandContainer: document.getElementById("my-hand-container"),
  myHandRank: document.getElementById("my-hand-rank"),
  actionPanel: document.getElementById("action-controls-panel"),
  btnFold: document.getElementById("btn-fold"),
  btnCall: document.getElementById("btn-call"),
  btnRaise: document.getElementById("btn-raise"),
  raiseSlider: document.getElementById("raise-slider"),
  raiseVal: document.getElementById("raise-val-display"),
  exitGame: document.getElementById("btn-exit-game")
};

const modals = {
  rules: document.getElementById("rules-modal"),
  rulesToggle: document.getElementById("rules-toggle-btn"),
  rulesClose: document.getElementById("btn-close-rules"),
  
  roulette: document.getElementById("roulette-modal"),
  rouletteWinner: document.getElementById("roulette-winner-name"),
  rouletteWheel: document.getElementById("roulette-wheel"),
  btnSpin: document.getElementById("btn-spin-roulette"),
  rouletteResultText: document.getElementById("roulette-result-text"),
  btnCloseRoulette: document.getElementById("btn-close-roulette"),
  
  showdown: document.getElementById("showdown-modal"),
  showdownPlayers: document.getElementById("showdown-players-container"),
  showdownBanner: document.getElementById("showdown-winner-banner"),
  showdownCelebration: document.getElementById("showdown-celebration-info"),
  btnNextHand: document.getElementById("btn-next-hand")
};

// --- P2P 通信インスタンス ---
let peerManager = null;

// --- 初期化 ---
window.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  loadSavedName();
  initRouletteWheel();
});

function loadSavedName() {
  const saved = localStorage.getItem("kabu_poker_name");
  if (saved) {
    lobbyInputs.name.value = saved;
    state.myName = saved;
  }
}

// --- イベントリスナー設定 ---
function setupEventListeners() {
  // ロビー画面ボタン
  lobbyButtons.cpu.addEventListener("click", startCpuMode);
  lobbyButtons.create.addEventListener("click", createOnlineRoom);
  lobbyButtons.join.addEventListener("click", joinOnlineRoom);
  
  lobbyInputs.name.addEventListener("change", (e) => {
    state.myName = e.target.value.trim() || "プレイヤー";
    localStorage.setItem("kabu_poker_name", state.myName);
  });

  // 待機画面ボタン
  waitingElems.start.addEventListener("click", startOnlineGame);
  waitingElems.leave.addEventListener("click", leaveWaitingRoom);

  // ゲーム画面アクション
  gameElems.btnFold.addEventListener("click", () => handlePlayerAction("fold"));
  gameElems.btnCall.addEventListener("click", () => handlePlayerAction("call"));
  gameElems.btnRaise.addEventListener("click", () => {
    const amount = parseInt(gameElems.raiseSlider.value, 10);
    handlePlayerAction("raise", amount);
  });
  gameElems.raiseSlider.addEventListener("input", (e) => {
    const val = e.target.value;
    gameElems.raiseVal.innerHTML = `<span class="chip-token"></span> ${val}`;
  });

  gameElems.exitGame.addEventListener("click", exitToLobby);

  // ルールモーダル
  modals.rulesToggle.addEventListener("click", () => modals.rules.style.display = "flex");
  modals.rulesClose.addEventListener("click", () => modals.rules.style.display = "none");
  modals.rules.addEventListener("click", (e) => {
    if (e.target === modals.rules) modals.rules.style.display = "none";
  });

  // ルーレットモーダル
  modals.btnSpin.addEventListener("click", spinRouletteWheel);
  modals.btnCloseRoulette.addEventListener("click", closeRouletteAndProceed);

  // 次の局へ
  modals.btnNextHand.addEventListener("click", startNextHand);

  // 合言葉コピー
  waitingElems.code.addEventListener("click", () => {
    navigator.clipboard.writeText(waitingElems.code.textContent);
    addLog("システム", "合言葉をクリップボードにコピーしました！", "log-system");
  });
}

// --- 画面切り替え ---
function showScreen(screenKey) {
  Object.keys(screens).forEach(key => {
    screens[key].style.display = key === screenKey ? "flex" : "none";
  });
  if (screenKey === "lobby") {
    screens.lobby.className = "lobby-container"; // グリッド表示に戻す
  }
}

// --- ロギング ---
function addLog(sender, text, className = "") {
  const logDiv = gameElems.log;
  const entry = document.createElement("div");
  entry.className = `log-entry ${className}`;
  if (sender) {
    entry.innerHTML = `<span class="log-highlight">${sender}</span>: ${text}`;
  } else {
    entry.innerHTML = text;
  }
  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;
}

// ==========================================
//        ゲームロジック・進行 (CPU & オンライン共通)
// ==========================================

// 山札生成（1が3枚、2〜10が各2枚の計21枚）
function generateDeck() {
  const deck = [1, 1, 1];
  for (let i = 2; i <= 10; i++) {
    deck.push(i, i);
  }
  return deck;
}

// フィッシャー・イェーツのシャッフル
function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 局（ハンド）の初期化
 */
function initHand() {
  addLog(null, "--- 新しい局が始まりました ---", "log-system");
  
  if (state.isHost) {
    state.deck = shuffle(generateDeck());
    
    // 全プレイヤーにカードを配る（非フォールド、ベットリセット、参加費徴収）
    state.pot = 0;
    state.currentBet = 0;
    state.betRound = 1;
    state.lastAggressorIndex = -1;
    state.actionCount = 0;
    
    state.players.forEach((p, idx) => {
      p.isFolded = false;
      p.roundBet = 0;
      p.totalBet = 0;
      
      // 参加費(アンティ)の支払い
      const antePaid = Math.min(p.chips, ANTE);
      p.chips -= antePaid;
      p.totalBet += antePaid;
      state.pot += antePaid;
      
      // 手札の配布（2枚）
      p.hand = [state.deck.pop(), state.deck.pop()];
    });
    
    // ラウンドの開始プレイヤー決定（親ディーラーの左隣）
    state.startingPlayerIndex = (state.dealerIndex + 1) % state.players.length;
    state.activePlayerIndex = state.startingPlayerIndex;
    
    if (state.gameType === "online") {
      broadcastGameState();
    } else {
      updateUI();
      startTurn();
    }
  }
}

/**
 * ターン開始時の処理
 */
function startTurn() {
  const activePlayer = state.players[state.activePlayerIndex];
  
  if (activePlayer.isFolded || activePlayer.chips <= 0) {
    // すでにフォールドしている、またはチップがない（オールイン済み）プレイヤーはパス
    moveToNextPlayer();
    return;
  }

  updateUI();

  // あなたのターンの場合
  if (activePlayer.id === "me") {
    addLog(null, "あなたの番です。行動を選択してください。", "log-highlight");
    enableActionPanel(true);
  } else {
    // CPUのターンの場合（CPU対戦モードのみ）
    enableActionPanel(false);
    if (activePlayer.isCpu) {
      addLog(null, `${activePlayer.name}の思考中...`);
      setTimeout(() => {
        executeCpuTurn(activePlayer);
      }, 1000 + Math.random() * 800);
    }
  }
}

/**
 * CPUのターン実行
 */
function executeCpuTurn(cpu) {
  const result = decideCpuAction({
    hand: cpu.hand,
    currentBet: state.currentBet,
    myCurrentBet: cpu.roundBet,
    chips: cpu.chips,
    pot: state.pot,
    round: state.betRound,
    playersInGame: state.players.filter(p => !p.isFolded).length,
    aggression: cpu.aggression || 0.5
  });
  
  processAction(cpu.id, result.action, result.amount);
}

/**
 * プレイヤーのアクションを処理（UIや通信から呼ばれる）
 */
function handlePlayerAction(action, raiseAmount = 0) {
  const activePlayer = state.players[state.activePlayerIndex];
  if (activePlayer.id !== "me") return;

  let amount = 0;
  if (action === "call") {
    amount = state.currentBet - activePlayer.roundBet;
  } else if (action === "raise") {
    // レイズ額＝コールに必要な額 ＋ 上乗せ額
    const callCost = state.currentBet - activePlayer.roundBet;
    amount = callCost + raiseAmount;
  }

  if (state.gameType === "online" && !state.isHost) {
    // クライアントの場合、アクションをホストに送信
    peerManager.send(null, {
      type: "ACTION",
      payload: { action, amount }
    });
    enableActionPanel(false);
  } else {
    // CPU対戦、またはオンラインのホスト自身の場合、直接処理
    processAction("me", action, amount);
  }
}

/**
 * アクションの実行・状態更新（ホスト側で実行）
 */
function processAction(playerId, action, amount) {
  const playerIdx = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIdx];
  
  if (action === "fold") {
    player.isFolded = true;
    addLog(player.name, "降参 (Fold) しました", "log-danger");
  } else if (action === "call") {
    // コール処理
    const actualBet = Math.min(player.chips, amount);
    player.chips -= actualBet;
    player.roundBet += actualBet;
    player.totalBet += actualBet;
    state.pot += actualBet;
    
    if (actualBet === 0 && state.currentBet === 0) {
      addLog(player.name, "パス (Check) しました");
    } else {
      addLog(player.name, `${actualBet} チップを賭けました (Call)`);
    }
  } else if (action === "raise") {
    // レイズ処理
    const actualBet = Math.min(player.chips, amount);
    player.chips -= actualBet;
    player.roundBet += actualBet;
    player.totalBet += actualBet;
    state.pot += actualBet;
    
    state.currentBet = player.roundBet;
    state.lastAggressorIndex = playerIdx; // レイズしたプレイヤーを記録
    addLog(player.name, `賭け金を上乗せしました (Raise: 合計 ${player.roundBet} チップ)`);
  }

  state.actionCount++;

  // 次のプレイヤーに回す前のチェック
  checkRoundState();
}

/**
 * ラウンド終了や対決移行の判定
 */
function checkRoundState() {
  const alivePlayers = state.players.filter(p => !p.isFolded);
  
  // 1. 生き残りが1名になったら、そのプレイヤーの不戦勝
  if (alivePlayers.length === 1) {
    handleDefaultWin(alivePlayers[0]);
    return;
  }

  // 2. ベット額が全員一致しているかの判定
  // アクションが1周しており、かつ非フォールドプレイヤー全員のこのラウンドのベット額が currentBet と等しい（またはオールイン）
  const activeAlivePlayers = alivePlayers.filter(p => p.chips > 0);
  
  // 賭け金が揃っているか確認
  const isBetsEqual = alivePlayers.every(p => p.roundBet === state.currentBet || p.chips === 0);
  // 全員が最低1回は意思決定しているか
  const isOneRoundPassed = state.actionCount >= alivePlayers.length;

  if (isBetsEqual && (isOneRoundPassed || state.lastAggressorIndex === -1)) {
    // 次のラウンドに進むか、ショーダウンへ
    moveToNextRound();
  } else {
    // 次のプレイヤーへターン移動
    moveToNextPlayer();
  }
}

function moveToNextPlayer() {
  do {
    state.activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
  } while (state.players[state.activePlayerIndex].isFolded || state.players[state.activePlayerIndex].chips <= 0);

  if (state.gameType === "online") {
    broadcastGameState();
  } else {
    startTurn();
  }
}

/**
 * 次のベットラウンドへの移行
 */
function moveToNextRound() {
  const alivePlayers = state.players.filter(p => !p.isFolded);
  
  // すべての生存者のうち、チップを持っているのが1人以下なら、ベットの余地がないため即ショーダウンへ
  const playersWithChips = alivePlayers.filter(p => p.chips > 0);
  const isAllInSituation = playersWithChips.length <= 1;

  if (state.betRound >= 3 || isAllInSituation) {
    // 3ラウンド終了、またはオールイン状況ならショーダウン
    handleShowdown();
  } else {
    // 次のベットラウンド開始
    state.betRound++;
    state.currentBet = 0;
    state.lastAggressorIndex = -1;
    state.actionCount = 0;
    
    // 各プレイヤーのラウンドベットリセット
    state.players.forEach(p => p.roundBet = 0);
    
    // 次のラウンドは、親に近い生存プレイヤーから
    state.activePlayerIndex = state.startingPlayerIndex;
    while (state.players[state.activePlayerIndex].isFolded) {
      state.activePlayerIndex = (state.activePlayerIndex + 1) % state.players.length;
    }

    addLog(null, `--- ベットラウンド ${state.betRound} 開始 ---`, "log-system");
    
    if (state.gameType === "online") {
      broadcastGameState();
    } else {
      updateUI();
      startTurn();
    }
  }
}

/**
 * 不戦勝（全員フォールド）の処理
 */
function handleDefaultWin(winner) {
  addLog(null, `${winner.name} 以外のプレイヤーが降参したため、不戦勝となりました！`, "log-system");
  
  // 0点（ブタ）ブラフで全員下ろした際のお祝儀適用チェック
  let giftDetails = "";
  const handEval = evaluateHand(winner.hand);
  const isButa = handEval.type === HAND_TYPES.POINTS_0;
  
  if (isButa) {
    giftDetails = "【お祝儀】0点（ブタ）ブラフ成功！他プレイヤーから3チップずつ徴収します。";
    state.players.forEach(p => {
      if (p.id !== winner.id) {
        const gift = Math.min(p.chips, 3);
        p.chips -= gift;
        winner.chips += gift;
      }
    });
  }

  // ポット獲得
  winner.chips += state.pot;
  
  // 結果ダイアログの表示 / オンライン時は同期送信
  const playerResults = [{
    id: winner.id,
    name: winner.name,
    hand: winner.hand,
    evaluatedName: handEval.name + (isButa ? " (ブラフ成功!)" : ""),
    isWinner: true
  }];

  if (state.gameType === "online") {
    broadcastShowdown(playerResults, giftDetails, false);
  } else {
    showShowdownResult(playerResults, giftDetails);
  }
}

/**
 * ショーダウン（手札公開と勝敗決定）
 */
function handleShowdown() {
  addLog(null, "--- 勝負 (ショーダウン) ---", "log-system");
  
  // 生存プレイヤーの勝敗比較
  const alivePlayers = state.players.filter(p => !p.isFolded);
  const result = determineWinners(alivePlayers);
  
  // チップ移動
  // ポットを勝者で分ける（端数は切り捨て）
  const winnerChips = Math.floor(state.pot / result.winners.length);
  const potAmount = state.pot;
  
  result.winners.forEach(winnerId => {
    const winIdx = state.players.findIndex(p => p.id === winnerId);
    if (winIdx !== -1) {
      triggerPotCollectEffect(winIdx, potAmount / result.winners.length);
    }
  });

  state.players.forEach(p => {
    if (result.winners.includes(p.id)) {
      p.chips += winnerChips;
    }
  });

  // お祝儀の処理
  let giftDetails = "";
  
  // 10.10（十ゾロ）お祝儀判定
  // 勝者の中に 10.10 のプレイヤーがいるか？ (1.2キラー相性で負けていない場合)
  const is10_10Winner = result.players.some(p => p.isWinner && p.hand[0] === 10 && p.hand[1] === 10 && !result.killerTriggered);
  
  // 1.1 (ピンゾロ) お祝儀判定
  const is1_1Winner = result.players.some(p => p.isWinner && p.hand[0] === 1 && p.hand[1] === 1);

  if (is10_10Winner) {
    giftDetails = "【お祝儀】十ゾロ (10.10) 勝利！敗者全員から20チップずつ徴収します。";
    state.players.forEach(p => {
      if (!result.winners.includes(p.id)) {
        const gift = Math.min(p.chips, 20);
        p.chips -= gift;
        // 勝者たちで等分する（通常は10.10は1枚のみ）
        const winPlayer = state.players.find(wp => wp.hand[0] === 10 && wp.hand[1] === 10);
        if (winPlayer) winPlayer.chips += gift;
      }
    });
  }

  // 1.1勝利時のルーレット発生フラグ
  if (is1_1Winner) {
    // 勝利したプレイヤーIDを保持し、ルーレットモーダルを起動する
    const winner1_1 = result.players.find(p => p.isWinner && p.hand[0] === 1 && p.hand[1] === 1);
    state.rouletteWinnerId = winner1_1.id;
    
    // オンラインの場合は全員にショーダウン情報を送ってからルーレット開始
    if (state.gameType === "online") {
      broadcastShowdown(result.players, "【お祝儀】ピンゾロ (1.1) 勝利につきルーレット起動！", true);
    } else {
      showShowdownResult(result.players, "【お祝儀】ピンゾロ (1.1) 勝利につきルーレット起動！");
    }
    return;
  }

  if (result.killerTriggered) {
    giftDetails += "【特殊】10.10キラー (1.2) が十ゾロ (10.10) を撃破しました！";
    
    // 1.2の勝者と、10.10の敗者を見つける
    const killerWinner = result.players.find(p => p.isWinner && (Math.min(...p.hand) === 1 && Math.max(...p.hand) === 2));
    const tozoroLosers = result.players.filter(p => !p.isWinner && (p.hand[0] === 10 && p.hand[1] === 10));
    
    if (killerWinner && tozoroLosers.length > 0) {
      let totalGift = 0;
      const winIdx = state.players.findIndex(p => p.id === killerWinner.id);
      
      tozoroLosers.forEach(loser => {
        const lp = state.players.find(p => p.id === loser.id);
        const loserIdx = state.players.findIndex(p => p.id === loser.id);
        if (lp && loserIdx !== -1) {
          const gift = Math.min(lp.chips, 30);
          lp.chips -= gift;
          totalGift += gift;
          
          // 10.10の敗者から1.2の勝者へチップ移動演出
          triggerGiftChipEffect(loserIdx, winIdx, gift);
        }
      });
      
      const wp = state.players.find(p => p.id === killerWinner.id);
      if (wp) wp.chips += totalGift;
      
      giftDetails += `\n【お祝儀】10.10キラー勝利！十ゾロ (10.10) のプレイヤーから 30 チップを徴収しました。`;
    }
  }

  if (state.gameType === "online") {
    broadcastShowdown(result.players, giftDetails, false);
  } else {
    showShowdownResult(result.players, giftDetails);
  }
}

/**
 * ショーダウン結果モーダルの表示
 */
function showShowdownResult(playerResults, giftText) {
  // 紙吹雪（confetti）
  const myResult = playerResults.find(pr => pr.id === "me");
  const isMeWinner = myResult && myResult.isWinner;
  
  if (isMeWinner) {
    // @ts-ignore
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ["#d4af37", "#b81c22", "#faf5eb"] // 金・朱赤・クリーム
    });
  }

  // UIに勝者リストを表示
  modals.showdownPlayers.innerHTML = "";
  playerResults.forEach(pr => {
    const cardHtml = pr.hand.map(c => renderCardHtml(c, false)).join("");
    const isFoldedText = state.players.find(p => p.id === pr.id).isFolded ? " (降参)" : "";
    
    modals.showdownPlayers.innerHTML += `
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 10px;">
        <div style="text-align: left;">
          <span style="font-family: var(--font-serif); font-weight: bold; font-size: 1.1rem; ${pr.isWinner ? 'color: var(--color-gold-light);' : ''}">
            ${pr.name} ${pr.isWinner ? '🏆' : ''}
          </span>
          <div style="font-size: 0.8rem; color: var(--color-muted); margin-top: 3px;">
            役: ${pr.evaluatedName}${isFoldedText}
          </div>
        </div>
        <div style="display: flex; gap: 5px;">
          ${cardHtml}
        </div>
      </div>
    `;
  });

  const winnerNames = playerResults.filter(pr => pr.isWinner).map(pr => pr.name).join(", ");
  modals.showdownBanner.textContent = `勝者: ${winnerNames}`;
  modals.showdownCelebration.innerHTML = giftText || "";

  // 「次の局へ」ボタンの表示制御（ホストのみ押せる）
  if (state.gameType === "online" && !state.isHost) {
    modals.btnNextHand.style.display = "none";
    addLog(null, "ホストが次の局を開始するのをお待ちください...", "log-muted");
  } else {
    modals.btnNextHand.style.display = "block";
  }

  modals.showdown.style.display = "flex";
}

/**
 * 次のハンドへ移行
 */
function startNextHand() {
  modals.showdown.style.display = "none";
  state.isTsuki = false;
  state.players = state.players.filter(p => !p.isDisconnected);

  if (state.gameType === "online") {
    if (state.isHost) {
      // 親の交代
      state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
      initHand();
    }
  } else {
    state.dealerIndex = (state.dealerIndex + 1) % state.players.length;
    initHand();
  }
}

// ==========================================
//             お祝儀ルーレット演出
// ==========================================

const rouletteSlices = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // 山札の数字の候補

function initRouletteWheel() {
  const wheel = modals.rouletteWheel;
  wheel.innerHTML = "";
  
  const numSlices = rouletteSlices.length;
  const anglePerSlice = 360 / numSlices;
  
  rouletteSlices.forEach((num, idx) => {
    // スライスの角度配置
    const rotation = idx * anglePerSlice;
    
    // 数字表示
    const slice = document.createElement("div");
    slice.className = "roulette-number-slice";
    slice.style.transform = `rotate(${rotation}deg)`;
    slice.textContent = getKanjiNumber(num);
    wheel.appendChild(slice);

    // 仕切り線
    const divider = document.createElement("div");
    divider.className = "roulette-divider";
    divider.style.transform = `rotate(${rotation + anglePerSlice / 2}deg)`;
    wheel.appendChild(divider);
  });
}

function triggerRoulette(winnerId) {
  const winner = state.players.find(p => p.id === winnerId);
  modals.rouletteWinner.textContent = winner.name;
  modals.rouletteResultText.style.display = "none";
  modals.btnCloseRoulette.style.display = "none";
  
  // ルーレットの回転を初期位置へ
  modals.rouletteWheel.style.transition = "none";
  modals.rouletteWheel.style.transform = "rotate(0deg)";
  
  // ホスト以外の場合、スピンボタンを無効化
  if (state.gameType === "online" && !state.isHost) {
    modals.btnSpin.style.display = "none";
    addLog(null, `${winner.name}のお祝儀ルーレットをホストが回しています...`, "log-muted");
  } else {
    modals.btnSpin.style.display = "block";
    modals.btnSpin.classList.remove("btn-disabled");
  }
  
  modals.roulette.style.display = "flex";
}

function spinRouletteWheel() {
  if (state.gameType === "online" && !state.isHost) return;
  
  modals.btnSpin.classList.add("btn-disabled");

  // ランダムに山札を引き、結果とする
  // (もし山札が空の場合は新しく山札からシャッフルして1枚引く)
  let rolledValue = 1;
  if (state.deck.length > 0) {
    rolledValue = state.deck.pop();
  } else {
    rolledValue = Math.floor(Math.random() * 10) + 1;
  }
  state.rouletteCardValue = rolledValue;

  // ルーレットの回転目標角度を決定
  // 1枚引いたカードの値インデックスを見つける
  const targetIndex = rouletteSlices.indexOf(rolledValue);
  const anglePerSlice = 360 / rouletteSlices.length;
  
  // ルーレット盤の回転（反時計回りに回して、針が上を指すように調整）
  // 針は上(0度)を指すため、ターゲットスライスが上に来るようにする
  // ターゲットの角度は targetIndex * anglePerSlice
  // 盤を `360 * 回転数 - ターゲット角度` 回す
  const spins = 5; // 5回転する
  const targetAngle = 360 * spins - (targetIndex * anglePerSlice);

  modals.rouletteWheel.style.transition = "transform 4s cubic-bezier(0.15, 0.85, 0.35, 1)";
  modals.rouletteWheel.style.transform = `rotate(${targetAngle}deg)`;

  if (state.gameType === "online") {
    // ゲストに向けてルーレット開始シグナルを送る
    peerManager.send(null, {
      type: "ROULETTE_SPIN",
      payload: { angle: targetAngle, result: rolledValue }
    });
  }

  // 4秒後に結果を表示
  setTimeout(() => {
    showRouletteResult(rolledValue);
  }, 4200);
}

function showRouletteResult(value) {
  const winner = state.players.find(p => p.id === state.rouletteWinnerId);
  const cost = value * 3;
  
  // チップの徴収処理
  state.players.forEach(p => {
    if (p.id !== winner.id) {
      const gift = Math.min(p.chips, cost);
      p.chips -= gift;
      winner.chips += gift;
    }
  });

  modals.rouletteResultText.textContent = `結果: 【${value}】引いた！各プレイヤーから ${cost} チップ獲得！`;
  modals.rouletteResultText.style.display = "block";

  // @ts-ignore
  confetti({
    particleCount: 50,
    angle: 60,
    spread: 55,
    origin: { x: 0 }
  });
  // @ts-ignore
  confetti({
    particleCount: 50,
    angle: 120,
    spread: 55,
    origin: { x: 1 }
  });

  if (state.gameType !== "online" || state.isHost) {
    modals.btnCloseRoulette.style.display = "block";
  } else {
    // ゲストの場合は、ホストが閉じるのを待つ
    addLog(null, "ホストが確認中...", "log-muted");
  }
}

function closeRouletteAndProceed() {
  modals.roulette.style.display = "none";
  
  // ルーレット後にショーダウン結果を表示
  const alivePlayers = state.players.filter(p => !p.isFolded);
  const result = determineWinners(alivePlayers);
  
  const winner = state.players.find(p => p.id === state.rouletteWinnerId);
  const cost = state.rouletteCardValue * 3;
  const giftText = `【お祝儀】ピンゾロ (1.1) 勝利ルーレット：結果【${state.rouletteCardValue}】により、敗者全員から ${cost} チップずつ徴収しました。`;

  if (state.gameType === "online") {
    broadcastShowdown(result.players, giftText, false);
  } else {
    showShowdownResult(result.players, giftText);
  }
}

// ==========================================
//             CPU対戦モード起動
// ==========================================
function startCpuMode() {
  state.gameType = "cpu";
  state.isHost = true;
  state.players = [
    { id: "me", name: state.myName, chips: INITIAL_CHIPS, hand: [], roundBet: 0, totalBet: 0, isFolded: false, isCpu: false, isHost: true },
    { id: "cpu1", name: "源氏 (CPU)", chips: INITIAL_CHIPS, hand: [], roundBet: 0, totalBet: 0, isFolded: false, isCpu: true, aggression: 0.4 },
    { id: "cpu2", name: "平家 (CPU)", chips: INITIAL_CHIPS, hand: [], roundBet: 0, totalBet: 0, isFolded: false, isCpu: true, aggression: 0.7 },
    { id: "cpu3", name: "藤原 (CPU)", chips: INITIAL_CHIPS, hand: [], roundBet: 0, totalBet: 0, isFolded: false, isCpu: true, aggression: 0.2 }
  ];
  state.dealerIndex = 0;
  
  showScreen("game");
  initHand();
}

// ==========================================
//            オンライン対戦モード (P2P)
// ==========================================

function createOnlineRoom() {
  state.gameType = "online";
  state.isHost = true;
  
  addLog("ロビー", "合言葉を取得中...");
  
  peerManager = new PeerManager({
    onIdReady: (id) => {
      state.roomCode = id;
      waitingElems.code.textContent = id;
      
      // 自身のプレイヤー登録
      state.players = [{
        id: "me",
        peerId: id,
        name: state.myName,
        chips: INITIAL_CHIPS,
        hand: [],
        roundBet: 0,
        totalBet: 0,
        isFolded: false,
        isCpu: false,
        isHost: true
      }];
      
      updateWaitingRoomUI();
      showScreen("waiting");
    },
    onConnectionChange: (peerId, status) => {
      if (status === "connected") {
        addLog("ロビー", `${peerId} が接続しました`);
      } else {
        addLog("ロビー", `${peerId} が切断しました`);
        
        // ゲーム中に切断された場合、そのプレイヤーをフォールドとして扱う
        if (state.mode === "game") {
          const p = state.players.find(pl => pl.peerId === peerId);
          if (p) {
            p.isFolded = true;
            p.isDisconnected = true;
            addLog(p.name, "接続が切れたため、降参扱いとします。", "log-danger");
            checkRoundState();
          }
        } else {
          state.players = state.players.filter(p => p.peerId !== peerId);
          updateWaitingRoomUI();
        }
      }
    },
    onMessage: (peerId, message) => {
      handleOnlineMessage(peerId, message);
    }
  });

  peerManager.initHost();
}

function joinOnlineRoom() {
  const code = lobbyInputs.joinCode.value.trim();
  if (!code) {
    alert("合言葉を入力してください");
    return;
  }

  state.gameType = "online";
  state.isHost = false;
  state.roomCode = code;
  
  addLog("ロビー", "ホストに接続中...");
  
  peerManager = new PeerManager({
    onIdReady: (id) => {
      state.myId = id;
    },
    onConnectionChange: (peerId, status) => {
      if (status === "connected") {
        addLog("ロビー", "ホストに接続しました！接続申請を送信中...");
        // 参加申請メッセージ送信
        peerManager.send(null, {
          type: "JOIN",
          payload: { name: state.myName }
        });
        showScreen("waiting");
      } else {
        addLog("ロビー", "ホストとの接続が切れました。");
        exitToLobby();
      }
    },
    onMessage: (peerId, message) => {
      handleOnlineMessage(peerId, message);
    }
  });

  peerManager.initClient(code);
}

function leaveWaitingRoom() {
  if (peerManager) {
    peerManager.cleanup();
  }
  exitToLobby();
}

function startOnlineGame() {
  if (!state.isHost || state.players.length < 2) return;
  
  state.dealerIndex = 0;
  state.mode = "game";
  showScreen("game");
  initHand();
}

/**
 * P2P メッセージ受信ハンドラ
 */
function handleOnlineMessage(peerId, msg) {
  const { type, payload } = msg;

  if (state.isHost) {
    // --- ホスト側での処理 ---
    if (type === "JOIN") {
      // 新規プレイヤー追加
      const newPlayer = {
        id: `player-${peerId}`,
        peerId: peerId,
        name: payload.name,
        chips: INITIAL_CHIPS,
        hand: [],
        roundBet: 0,
        totalBet: 0,
        isFolded: false,
        isCpu: false,
        isHost: false
      };
      
      // 最大4人まで
      if (state.players.length < 4) {
        state.players.push(newPlayer);
        addLog("ロビー", `${payload.name} が参加しました`);
        updateWaitingRoomUI();
        
        // 全員に現在のプレイヤーリストを同期
        broadcastPlayerList();
      } else {
        // 満員拒否
        peerManager.send(peerId, { type: "JOIN_REJECT", payload: { reason: "満員です" } });
      }
    }
    
    if (type === "ACTION") {
      // プレイヤーからのアクション実行
      const playerIdx = state.players.findIndex(p => p.peerId === peerId);
      const player = state.players[playerIdx];
      
      if (playerIdx === state.activePlayerIndex) {
        processAction(player.id, payload.action, payload.amount);
      }
    }
  } else {
    // --- クライアント側での処理 ---
    if (type === "JOIN_REJECT") {
      alert(`接続拒否: ${payload.reason}`);
      exitToLobby();
    }
    
    if (type === "PLAYER_LIST_UPDATE") {
      // プレイヤーリスト同期
      syncPlayers(payload.players);
      updateWaitingRoomUI();
    }
    
    if (type === "GAME_STATE_UPDATE") {
      // ゲーム画面への遷移
      if (state.mode !== "game") {
        state.mode = "game";
        showScreen("game");
      }
      
      // ゲーム状態の同期
      syncGameState(payload);
      updateUI();
      
      // 自分のターンであれば
      const activePlayer = state.players[state.activePlayerIndex];
      if (activePlayer.id === "me") {
        addLog(null, "あなたの番です。行動を選択してください。", "log-highlight");
        enableActionPanel(true);
      } else {
        enableActionPanel(false);
      }
    }

    if (type === "ROULETTE_SPIN") {
      // ルーレットのアニメーション開始
      modals.rouletteWheel.style.transition = "transform 4s cubic-bezier(0.15, 0.85, 0.35, 1)";
      modals.rouletteWheel.style.transform = `rotate(${payload.angle}deg)`;
      
      setTimeout(() => {
        showRouletteResult(payload.result);
      }, 4200);
    }
    
    if (type === "SHOWDOWN_UPDATE") {
      // ショーダウン結果の同期
      syncPlayers(payload.players);
      state.pot = payload.pot;
      
      if (payload.triggerRoulette) {
        triggerRoulette(payload.rouletteWinnerId);
      } else {
        showShowdownResult(payload.playerResults, payload.giftText);
      }
    }
  }
}

// ホスト -> 全員：プレイヤーリスト同期
function broadcastPlayerList() {
  const syncList = state.players.map(p => ({
    id: p.id === "me" ? `player-${p.peerId}` : p.id,
    peerId: p.peerId,
    name: p.name,
    isHost: p.isHost
  }));
  
  peerManager.send(null, {
    type: "PLAYER_LIST_UPDATE",
    payload: { players: syncList }
  });
}

// ホスト -> 全員：ゲームステート配信（手札は自分のみ見せる）
function broadcastGameState() {
  state.players.forEach(p => {
    if (p.id === "me") {
      // ホスト自分自身への同期はローカルで行う
      return;
    }
    
    // 各ゲスト用のペイロード作成（カード情報を隠す）
    const guestPayload = {
      players: state.players.map(pl => ({
        id: pl.id === p.id ? "me" : (pl.id === "me" ? "host" : pl.id),
        name: pl.name,
        chips: pl.chips,
        roundBet: pl.roundBet,
        totalBet: pl.totalBet,
        isFolded: pl.isFolded,
        isHost: pl.isHost,
        // 手札は宛先が自分のときのみ公開、それ以外は枚数(2枚)だけ
        hand: pl.id === p.id ? pl.hand : [0, 0] 
      })),
      pot: state.pot,
      currentBet: state.currentBet,
      betRound: state.betRound,
      activePlayerIndex: state.activePlayerIndex,
      dealerIndex: state.dealerIndex,
      deckCount: state.deck.length
    };
    
    peerManager.send(p.peerId, {
      type: "GAME_STATE_UPDATE",
      payload: guestPayload
    });
  });

  // ローカルUIの更新とターン開始
  updateUI();
  startTurn();
}

// ホスト -> 全員：ショーダウン同期
function broadcastShowdown(playerResults, giftText, triggerRouletteFlag) {
  // playerResults内のIDをクライアント視点にマッピングしてブロードキャスト
  state.players.forEach(p => {
    if (p.id === "me") return;
    
    const clientResults = playerResults.map(pr => {
      let mappedId = pr.id;
      if (pr.id === "me") mappedId = "host";
      else if (pr.id === p.id) mappedId = "me";
      
      let mappedName = pr.name;
      
      return {
        ...pr,
        id: mappedId,
        name: mappedName
      };
    });

    peerManager.send(p.peerId, {
      type: "SHOWDOWN_UPDATE",
      payload: {
        playerResults: clientResults,
        giftText,
        pot: state.pot,
        triggerRoulette: triggerRouletteFlag,
        rouletteWinnerId: state.rouletteWinnerId === "me" ? "host" : (state.rouletteWinnerId === p.id ? "me" : state.rouletteWinnerId),
        players: state.players.map(pl => ({
          id: pl.id === p.id ? "me" : (pl.id === "me" ? "host" : pl.id),
          chips: pl.chips
        }))
      }
    });
  });

  if (triggerRouletteFlag) {
    triggerRoulette(state.rouletteWinnerId);
  } else {
    showShowdownResult(playerResults, giftText);
  }
}

// クライアント側：プレイヤー同期
function syncPlayers(syncList) {
  state.players = syncList.map(p => {
    const existing = state.players.find(ep => ep.id === p.id);
    return {
      ...p,
      chips: p.chips !== undefined ? p.chips : (existing ? existing.chips : INITIAL_CHIPS),
      hand: existing ? existing.hand : [],
      roundBet: existing ? existing.roundBet : 0,
      isFolded: existing ? existing.isFolded : false
    };
  });
}

// クライアント側：ゲーム状態同期
function syncGameState(payload) {
  // プレイヤー配列の同期
  state.players = payload.players;
  state.pot = payload.pot;
  state.currentBet = payload.currentBet;
  state.betRound = payload.betRound;
  state.activePlayerIndex = payload.activePlayerIndex;
  state.dealerIndex = payload.dealerIndex;
  state.deckCount = payload.deckCount;
}

// 待機室 UI の更新
function updateWaitingRoomUI() {
  waitingElems.list.innerHTML = "";
  state.players.forEach(p => {
    const isMe = p.id === "me" || (p.peerId === state.myId);
    const hostBadge = p.isHost ? `<span class="member-host-badge">親</span>` : "";
    waitingElems.list.innerHTML += `
      <li class="member-item">
        <span>${p.name} ${isMe ? "(あなた)" : ""}</span>
        ${hostBadge}
      </li>
    `;
  });

  // オンライン対戦開始ボタンの有効化（ホストかつ2人以上）
  if (state.isHost && state.players.length >= 2) {
    waitingElems.start.classList.remove("btn-disabled");
    waitingElems.status.textContent = "対戦を開始できます。";
  } else {
    waitingElems.start.classList.add("btn-disabled");
    if (state.isHost) {
      waitingElems.status.textContent = "他のプレイヤーが接続するのを待っています（最低2名必要）...";
    } else {
      waitingElems.status.textContent = "ホストがゲームを開始するのをお待ちください...";
    }
  }
}

// ==========================================
//              UI 描画・更新
// ==========================================

function updateUI() {
  // ポットとラウンドの更新
  gameElems.pot.textContent = state.pot;
  gameElems.roundText.textContent = `ベットラウンド ${state.betRound}`;
  gameElems.deckText.textContent = `山札: ${state.deckCount !== undefined ? state.deckCount : state.deck.length}枚`;

  // プレイヤー席の描画クリア
  const seatIds = ["seat-top", "seat-left", "seat-right", "seat-bottom"];
  
  // 席の初期非表示
  seatIds.forEach(id => document.getElementById(id).style.display = "none");

  // 自分の座席は常に seat-bottom (下座)
  // 他のプレイヤーを順次 top, left, right に割り当てる
  const myIndex = state.players.findIndex(p => p.id === "me");
  
  const seatAssignments = ["seat-bottom", "seat-top", "seat-left", "seat-right"];
  
  state.players.forEach((p, idx) => {
    // 自分基準の相対インデックス
    const relativeIdx = (idx - myIndex + state.players.length) % state.players.length;
    const seatId = seatAssignments[relativeIdx];
    const seatDiv = document.getElementById(seatId);
    
    seatDiv.style.display = "flex";
    
    // パネル要素の更新
    const panelId = seatId.replace("seat-", "panel-player");
    const nameId = seatId.replace("seat-", "name-player");
    const chipsId = seatId.replace("seat-", "chips-player");
    const cardsId = seatId.replace("seat-", "cards-player");
    const badgeId = seatId.replace("seat-", "badge-player");
    
    const panel = document.getElementById(panelId);
    const nameEl = document.getElementById(nameId);
    const chipsEl = document.getElementById(chipsId);
    const cardsEl = document.getElementById(cardsId);
    const badge = document.getElementById(badgeId);
    
    nameEl.textContent = p.name + (idx === state.dealerIndex ? " (親)" : "");
    chipsEl.textContent = p.chips;
    
    // アクティブな人の枠線を強調
    if (idx === state.activePlayerIndex && state.mode !== "showdown") {
      panel.classList.add("active-turn");
    } else {
      panel.classList.remove("active-turn");
    }
    
    // フォールド表示
    if (p.isFolded) {
      panel.classList.add("folded");
      badge.style.display = "inline-block";
      badge.className = "player-status-badge badge-fold";
      badge.textContent = "降参";
    } else {
      panel.classList.remove("folded");
      // ベット額表示
      if (p.roundBet > 0) {
        badge.style.display = "inline-block";
        badge.className = "player-status-badge badge-bet";
        badge.textContent = `${p.roundBet} 賭`;
      } else {
        badge.style.display = "none";
      }
    }
    
    // 他のプレイヤーの手札の裏面表示
    if (p.id !== "me") {
      cardsEl.innerHTML = "";
      if (p.hand && p.hand.length === 2 && !p.isFolded) {
        cardsEl.appendChild(createMiniCardBack());
        cardsEl.appendChild(createMiniCardBack());
      }
    }
  });

  // 自分の手札をテーブル下部に大きく描画
  const myPlayer = state.players[myIndex];
  if (myPlayer && myPlayer.hand && myPlayer.hand.length === 2) {
    gameElems.myHandContainer.innerHTML = "";
    
    // 配られたアニメーション（新規手札の時だけdeal-inアニメーションを付与）
    const c1 = renderCardElement(myPlayer.hand[0], true);
    const c2 = renderCardElement(myPlayer.hand[1], true);
    c1.classList.add("dealing");
    c2.classList.add("dealing");
    
    gameElems.myHandContainer.appendChild(c1);
    gameElems.myHandContainer.appendChild(c2);
    
    // 役判定表示
    const myEval = evaluateHand(myPlayer.hand);
    
    // 1.2の特殊判定表記（相手に10.10がいる場合はキラーと明記）
    const is1_2 = (Math.min(...myPlayer.hand) === 1 && Math.max(...myPlayer.hand) === 2);
    if (is1_2) {
      gameElems.myHandRank.textContent = "手札: 三点 (1.2) [十ゾロキラー]";
    } else {
      gameElems.myHandRank.textContent = `手札: ${myEval.name}`;
    }
  } else {
    gameElems.myHandContainer.innerHTML = "";
    gameElems.myHandRank.textContent = "手札: --";
  }

  // アクションボタン等の更新（自分のターンのみ）
  updateActionControls();
}

/**
 * 自分のアクションパネルの更新
 */
function updateActionControls() {
  const myPlayer = state.players.find(p => p.id === "me");
  const activePlayer = state.players[state.activePlayerIndex];
  
  if (!myPlayer || !activePlayer || activePlayer.id !== "me" || myPlayer.isFolded) {
    enableActionPanel(false);
    return;
  }

  enableActionPanel(true);

  // コールに必要な額
  const callAmount = state.currentBet - myPlayer.roundBet;
  
  if (callAmount === 0) {
    gameElems.btnCall.textContent = "パス (Check)";
  } else {
    // コール額が手持ちチップを超える場合は「全賭け (All-in)」
    if (callAmount >= myPlayer.chips) {
      gameElems.btnCall.textContent = `全賭け (All-in: ${myPlayer.chips})`;
    } else {
      gameElems.btnCall.textContent = `同額 (Call: ${callAmount})`;
    }
  }

  // レイズスライダーの更新
  const minRaise = 1;
  const maxPossibleRaise = Math.min(3, myPlayer.chips - callAmount);
  
  if (maxPossibleRaise < minRaise || myPlayer.chips <= callAmount) {
    // レイズ不可
    document.getElementById("raise-slider-container").style.display = "none";
  } else {
    document.getElementById("raise-slider-container").style.display = "flex";
    gameElems.raiseSlider.min = minRaise;
    gameElems.raiseSlider.max = maxPossibleRaise;
    gameElems.raiseSlider.value = minRaise;
    gameElems.raiseVal.innerHTML = `<span class="chip-token"></span> ${minRaise}`;
  }
}

function enableActionPanel(enable) {
  if (enable) {
    gameElems.actionPanel.classList.remove("btn-disabled");
  } else {
    gameElems.actionPanel.classList.add("btn-disabled");
  }
}

// --- カードの和風SVG/HTML生成 ---
function renderCardElement(num, isLarge = true) {
  const cardDiv = document.createElement("div");
  cardDiv.className = `kabu-card ${isLarge ? 'my-card' : ''}`;
  
  const faceDiv = document.createElement("div");
  faceDiv.className = "card-face";
  
  const jpNum = getKanjiNumber(num);
  const jpNumDiv = document.createElement("div");
  jpNumDiv.className = "card-num-jp";
  jpNumDiv.textContent = jpNum;
  if (num === 1) jpNumDiv.style.color = "var(--color-vermilion)"; // 1は赤文字
  
  const artworkDiv = document.createElement("div");
  artworkDiv.className = "card-artwork";
  artworkDiv.innerHTML = getCardArtworkSvg(num);

  const enNumDiv = document.createElement("div");
  enNumDiv.className = "card-num-en";
  enNumDiv.textContent = num;
  
  faceDiv.appendChild(jpNumDiv);
  faceDiv.appendChild(artworkDiv);
  faceDiv.appendChild(enNumDiv);
  cardDiv.appendChild(faceDiv);
  
  return cardDiv;
}

function renderCardHtml(num, isLarge = false) {
  const jpNum = getKanjiNumber(num);
  const colorStyle = num === 1 ? 'color: var(--color-vermilion);' : '';
  const sizeClass = isLarge ? 'my-card' : '';
  return `
    <div class="kabu-card ${sizeClass}">
      <div class="card-face">
        <div class="card-num-jp" style="${colorStyle}">${jpNum}</div>
        <div class="card-artwork">${getCardArtworkSvg(num)}</div>
        <div class="card-num-en">${num}</div>
      </div>
    </div>
  `;
}

function createMiniCardBack() {
  const cardDiv = document.createElement("div");
  cardDiv.className = "kabu-card card-back";
  return cardDiv;
}

function getKanjiNumber(num) {
  const kanji = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  return kanji[num] || "";
}

/**
 * 数字に応じた美しい和風SVGアートワークを生成
 */
function getCardArtworkSvg(num) {
  // カラーパレット
  const red = "#b81c22";
  const gold = "#d4af37";
  const dark = "#2b2523";
  const blue = "#2b5c8f";

  // 伝統的和柄やオブジェクト
  switch(num) {
    case 1: // 菊の日の出（ピン）
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <circle cx="50" cy="50" r="30" fill="${red}" />
          <path d="M 50,10 L 50,90 M 10,50 L 90,50 M 22,22 L 78,78 M 22,78 L 78,22" stroke="${gold}" stroke-width="2" />
        </svg>
      `;
    case 2: // 桐の葉（クローバー風）
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <path d="M 50,25 C 40,25 35,40 50,55 C 65,40 60,25 50,25 Z" fill="${dark}" />
          <path d="M 30,50 C 20,50 15,65 30,80 C 45,65 40,50 30,50 Z" fill="${dark}" />
          <path d="M 70,50 C 60,50 55,65 70,80 C 85,65 80,50 70,50 Z" fill="${dark}" />
          <circle cx="50" cy="65" r="8" fill="${red}" />
        </svg>
      `;
    case 3: // 桜
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <path d="M50 15 C45 35, 25 30, 35 50 C20 45, 15 65, 35 70 C30 85, 50 80, 50 65 C50 80, 70 85, 65 70 C85 65, 80 45, 65 50 C75 30, 55 35, 50 15 Z" fill="${red}" stroke="${gold}" stroke-width="1.5" />
          <circle cx="50" cy="53" r="5" fill="${gold}" />
        </svg>
      `;
    case 4: // 藤の格子
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <rect x="25" y="20" width="50" height="60" fill="none" stroke="${blue}" stroke-width="4" />
          <line x1="25" y1="40" x2="75" y2="40" stroke="${blue}" stroke-width="2" />
          <line x1="25" y1="60" x2="75" y2="60" stroke="${blue}" stroke-width="2" />
          <circle cx="50" cy="40" r="6" fill="${red}" />
          <circle cx="50" cy="60" r="6" fill="${gold}" />
        </svg>
      `;
    case 5: // 梅
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <circle cx="50" cy="38" r="14" fill="${red}" />
          <circle cx="35" cy="55" r="14" fill="${red}" />
          <circle cx="65" cy="55" r="14" fill="${red}" />
          <circle cx="41" cy="72" r="14" fill="${red}" />
          <circle cx="59" cy="72" r="14" fill="${red}" />
          <circle cx="50" cy="55" r="8" fill="${gold}" />
        </svg>
      `;
    case 6: // 牡丹の扇
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <path d="M15 75 C 30 45, 70 45, 85 75 Z" fill="${gold}" stroke="${dark}" stroke-width="2" />
          <path d="M15 75 L 50 85 L 85 75 Z" fill="${red}" />
          <circle cx="50" cy="60" r="10" fill="${dark}" />
        </svg>
      `;
    case 7: // 萩の猪・矢がすり模様
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <path d="M 20 20 L 50 50 L 20 80 M 80 20 L 50 50 L 80 80" stroke="${blue}" stroke-width="6" fill="none" stroke-linejoin="round"/>
          <circle cx="50" cy="50" r="12" fill="${red}" />
        </svg>
      `;
    case 8: // ススキに月
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <circle cx="50" cy="45" r="28" fill="${gold}" />
          <path d="M 20 90 Q 50 40, 80 90 M 35 90 Q 50 50, 65 90" stroke="${dark}" stroke-width="3" fill="none" />
        </svg>
      `;
    case 9: // 盃に菊
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <path d="M 20 40 Q 50 20, 80 40 L 65 75 Q 50 85, 35 75 Z" fill="${red}" stroke="${gold}" stroke-width="2" />
          <text x="50" y="58" font-family="var(--font-serif)" font-size="20" font-weight="900" fill="${gold}" text-anchor="middle">寿</text>
        </svg>
      `;
    case 10: // 紅葉に鹿
      return `
        <svg viewBox="0 0 100 100" class="artwork-svg">
          <path d="M 50,15 L 80,45 L 65,45 L 80,75 L 20,75 L 35,45 L 20,45 Z" fill="${red}" stroke="${gold}" stroke-width="2" />
          <circle cx="50" cy="60" r="8" fill="${dark}" />
        </svg>
      `;
    default:
      return `<svg viewBox="0 0 100 100" class="artwork-svg"></svg>`;
  }
}

// ==========================================
//              ユーティリティ系
// ==========================================

function exitToLobby() {
  if (peerManager) {
    peerManager.cleanup();
  }
  
  // モーダルをすべて閉じる
  modals.rules.style.display = "none";
  modals.roulette.style.display = "none";
  modals.showdown.style.display = "none";
  
  state.mode = "lobby";
  state.players = [];
  
  showScreen("lobby");
  addLog(null, "ロビーに戻りました。");
}
