import { useState } from 'react';

export function Onboarding() {
  const [leader, setLeader] = useState('');
  const [capital, setCapital] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!leader || !capital) {
      setStatus('leader and capital are required');
      return;
    }
    // Reference UI only: this submit composes the call shape the user
    // would sign via their wallet. The full wallet-connect flow (eg.
    // injected provider + walletClient.writeContract) is left to the
    // operator's chosen wallet adapter.
    setStatus(
      `would call subscribe(${leader}, ${capital}). connect your wallet provider to dispatch.`
    );
  }

  return (
    <div className="panel">
      <h2>subscribe to a leader</h2>
      <p className="muted">
        Delegate USDC to a registered leader. The leader's bond is collateral; if the watchdog
        flags degradation and the arbiter upholds the claim, slashed funds route to the daman
        treasury for restitution flows.
      </p>
      <form className="form" onSubmit={submit}>
        <label>
          leader address
          <input
            type="text"
            value={leader}
            onChange={(e) => setLeader(e.target.value)}
            placeholder="0x..."
          />
        </label>
        <label>
          capital (USDC, atomic units)
          <input
            type="text"
            value={capital}
            onChange={(e) => setCapital(e.target.value)}
            placeholder="1000000000000000000"
          />
        </label>
        <button type="submit">prepare subscribe</button>
      </form>
      {status && <div className="status">{status}</div>}
    </div>
  );
}
