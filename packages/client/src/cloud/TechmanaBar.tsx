/**
 * ロビーに置くテクマナ連携の帯。
 *
 * 未連携ならログインボタン、連携済みなら誰としてログインしているかと
 * 解除ボタンを出す。テクマナ連携がサーバで未設定なら何も出さない。
 */

import { useCallback, useEffect, useState } from 'react';
import { LOGIN_PATH, type TechmanaStatus, fetchStatus, logout } from './api.js';
import { flushCloudPush, resetCloud, syncNow } from './sync.js';

const box: React.CSSProperties = {
  padding: '12px 18px',
  marginBottom: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
};

const label: React.CSSProperties = {
  color: 'rgba(0,200,255,0.7)',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 1,
  whiteSpace: 'nowrap',
};

const primaryBtn: React.CSSProperties = {
  padding: '8px 18px',
  fontSize: 14,
  fontWeight: 800,
  background: 'linear-gradient(180deg, #00a0dd, #0066aa)',
  color: '#fff',
  border: '2px solid rgba(0,200,255,0.5)',
  borderRadius: 8,
  cursor: 'pointer',
  letterSpacing: 1,
};

const quietBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  background: 'transparent',
  color: 'rgba(160,200,230,0.85)',
  border: '1px solid rgba(0,200,255,0.3)',
  borderRadius: 6,
  cursor: 'pointer',
};

const note: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(160,200,230,0.7)',
  margin: 0,
  flexBasis: '100%',
};

export default function TechmanaBar() {
  const [status, setStatus] = useState<TechmanaStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // 認可の往復から戻ってきた合図を読み、URL からは消す。
  // 消さないと再読み込みのたびに同じ通知が出る。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('techmana');
    if (flag === null) return;

    const reason = params.get('reason');
    params.delete('techmana');
    params.delete('reason');
    const q = params.toString();
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash}`,
    );

    setNotice(
      flag === 'ok'
        ? { ok: true, text: 'テクマナと連携しました。設定と記録がアカウントに保存されます。' }
        : { ok: false, text: errorText(reason) },
    );
  }, []);

  useEffect(() => {
    let alive = true;
    void fetchStatus().then((s) => {
      if (!alive) return;
      setStatus(s);
      // 連携済みならこの時点で引き込む。設定が別端末のものに揃う。
      if (s.linked) void syncNow();
    });
    return () => {
      alive = false;
    };
  }, []);

  // 離脱直前に押し込む。デバウンス待ちのぶんを取りこぼさないため。
  useEffect(() => {
    const onHide = () => {
      void flushCloudPush();
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  const handleLogout = useCallback(async () => {
    setBusy(true);
    try {
      // 消す前に、まだ送っていない変更を送りきる。
      await flushCloudPush();
      await logout();
      resetCloud();
      setStatus((s) => (s ? { ...s, linked: false, nickname: null, sub: null } : s));
      setNotice({ ok: true, text: 'テクマナ連携を解除しました。設定はこの端末に残ります。' });
    } catch {
      setNotice({ ok: false, text: '連携を解除できませんでした。' });
    } finally {
      setBusy(false);
    }
  }, []);

  // サーバ側で未設定なら、機能自体を見せない。
  if (!status?.enabled) {
    return notice ? <Notice notice={notice} onClose={() => setNotice(null)} /> : null;
  }

  return (
    <>
      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}
      <div className="t99-frame" style={box}>
        <span style={label}>テクマナ</span>
        {status.linked ? (
          <>
            <span style={{ color: '#00ff88', fontSize: 14, fontWeight: 700 }}>
              {status.nickname || 'ログイン中'}
            </span>
            <button type="button" style={quietBtn} disabled={busy} onClick={() => void handleLogout()}>
              連携を解除
            </button>
            <p style={note}>設定・キー配置・自己ベストがアカウントに保存されます。</p>
          </>
        ) : (
          <>
            <button
              type="button"
              style={primaryBtn}
              disabled={busy}
              onClick={() => window.location.assign(LOGIN_PATH)}
            >
              テクマナでログイン
            </button>
            <p style={note}>
              ログインすると設定・キー配置・自己ベストがアカウントに保存され、別の端末でも引き継げます。
            </p>
          </>
        )}
      </div>
    </>
  );
}

function Notice({
  notice,
  onClose,
}: {
  notice: { ok: boolean; text: string };
  onClose: () => void;
}) {
  return (
    <div
      className="t99-frame"
      style={{
        padding: '10px 16px',
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        borderColor: notice.ok ? 'rgba(0,255,136,0.5)' : 'rgba(255,180,0,0.5)',
      }}
    >
      <span style={{ fontSize: 13, color: notice.ok ? '#00ff88' : '#ffb400', flex: 1 }}>
        {notice.text}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        style={{ ...quietBtn, padding: '2px 8px' }}
      >
        ×
      </button>
    </div>
  );
}

/** サーバが付けた reason を、利用者が次にとれる行動に translate する。 */
function errorText(reason: string | null): string {
  switch (reason) {
    case 'denied':
      return 'テクマナ側で連携が許可されませんでした。';
    case 'expired':
    case 'state':
      return '連携の手続きが時間切れになりました。もう一度お試しください。';
    case 'disabled':
      return 'テクマナ連携は現在利用できません。';
    default:
      return 'テクマナと連携できませんでした。時間をおいてお試しください。';
  }
}
