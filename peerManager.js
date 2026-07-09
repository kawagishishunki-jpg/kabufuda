/**
 * PeerJS (WebRTC) を利用したP2P通信管理モジュール (peerManager.js)
 * Host-Clientモデルで動作します。
 */

class PeerManager {
  constructor({ onMessage, onConnectionChange, onIdReady }) {
    this.peer = null;
    this.connections = {}; // client connection map (id -> connection)
    this.hostConnection = null; // connection to the host (for clients)
    this.isHost = false;
    this.peerId = null;
    
    // コールバック
    this.onMessage = onMessage || (() => {});
    this.onConnectionChange = onConnectionChange || (() => {});
    this.onIdReady = onIdReady || (() => {});
  }

  /**
   * ホストとしてルームを初期化する
   * @param {string} customId - ルームコード（指定がなければ自動生成）
   */
  initHost(customId = null) {
    this.isHost = true;
    this.cleanup();

    // 4桁〜6桁のルームコードを生成しやすくするため、短いIDで試みる、または自動生成のデフォルトIDを使用
    // PeerJSのシグナリングサーバーはIDの衝突を避けるため、一意なIDが必要
    // ルームコードとして利用しやすいよう、プレフィックス+ランダムな数字にする
    const roomId = customId || `kabu-${Math.floor(1000 + Math.random() * 9000)}`;

    // @ts-ignore (CDN経由で読み込まれるグローバルPeer)
    this.peer = new Peer(roomId, {
      debug: 1 // エラーのみログ出力
    });

    this.peer.on("open", (id) => {
      this.peerId = id;
      this.onIdReady(id);
    });

    this.peer.on("connection", (conn) => {
      this.setupHostConnection(conn);
    });

    this.peer.on("error", (err) => {
      console.error("PeerJS Error (Host):", err);
      if (err.type === "unavailable-id") {
        // IDが既に使用されている場合は、再試行する
        const nextId = `kabu-${Math.floor(1000 + Math.random() * 9000)}`;
        this.initHost(nextId);
      }
    });
  }

  /**
   * ゲストとしてホストに接続する
   * @param {string} hostId - 接続先ホストのルームコード
   */
  initClient(hostId) {
    this.isHost = false;
    this.cleanup();

    // 自身の一意なPeer IDを作成（自動生成）
    // @ts-ignore
    this.peer = new Peer({
      debug: 1
    });

    this.peer.on("open", (id) => {
      this.peerId = id;
      this.onIdReady(id);
      
      // ホストへ接続
      const conn = this.peer.connect(hostId, {
        reliable: true
      });
      this.setupClientConnection(conn);
    });

    this.peer.on("error", (err) => {
      console.error("PeerJS Error (Client):", err);
    });
  }

  /**
   * ホスト側でのクライアント接続セットアップ
   */
  setupHostConnection(conn) {
    const peerId = conn.peer;
    this.connections[peerId] = conn;

    conn.on("open", () => {
      this.onConnectionChange(peerId, "connected");
    });

    conn.on("data", (data) => {
      this.onMessage(peerId, data);
    });

    conn.on("close", () => {
      delete this.connections[peerId];
      this.onConnectionChange(peerId, "disconnected");
    });

    conn.on("error", (err) => {
      console.error(`Connection error with ${peerId}:`, err);
      delete this.connections[peerId];
      this.onConnectionChange(peerId, "disconnected");
    });
  }

  /**
   * クライアント側でのホスト接続セットアップ
   */
  setupClientConnection(conn) {
    this.hostConnection = conn;

    conn.on("open", () => {
      this.onConnectionChange(conn.peer, "connected");
    });

    conn.on("data", (data) => {
      this.onMessage(conn.peer, data);
    });

    conn.on("close", () => {
      this.hostConnection = null;
      this.onConnectionChange(conn.peer, "disconnected");
    });

    conn.on("error", (err) => {
      console.error("Host connection error:", err);
      this.hostConnection = null;
      this.onConnectionChange(conn.peer, "disconnected");
    });
  }

  /**
   * メッセージを送信する
   * @param {string|null} targetId - 送信先ID（nullの場合は全接続先に送信（ホストのみ））
   * @param {object} data - 送信するデータオブジェクト
   */
  send(targetId, data) {
    if (this.isHost) {
      if (targetId) {
        const conn = this.connections[targetId];
        if (conn && conn.open) {
          conn.send(data);
        }
      } else {
        // 全員にブロードキャスト
        Object.values(this.connections).forEach(conn => {
          if (conn.open) {
            conn.send(data);
          }
        });
      }
    } else {
      // クライアントはホストのみに送信
      if (this.hostConnection && this.hostConnection.open) {
        this.hostConnection.send(data);
      } else {
        console.warn("Host connection is not open. Cannot send message.");
      }
    }
  }

  /**
   * 接続解除・リソース解放
   */
  cleanup() {
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.connections = {};
    this.hostConnection = null;
    this.peerId = null;
  }
}

// グローバルスコープへ公開
window.PeerManager = PeerManager;

