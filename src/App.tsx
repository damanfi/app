import { useState } from 'react';
import { Leaderboard } from './components/Leaderboard';
import { Onboarding } from './components/Onboarding';
import { Receipts } from './components/Receipts';

type Tab = 'leaderboard' | 'onboarding' | 'receipts';

export function App() {
  const [tab, setTab] = useState<Tab>('leaderboard');
  return (
    <div className="app">
      <header className="header">
        <div className="brand">daman</div>
        <nav className="nav">
          <button
            className={tab === 'leaderboard' ? 'active' : ''}
            onClick={() => setTab('leaderboard')}
          >
            leaderboard
          </button>
          <button
            className={tab === 'onboarding' ? 'active' : ''}
            onClick={() => setTab('onboarding')}
          >
            subscribe
          </button>
          <button
            className={tab === 'receipts' ? 'active' : ''}
            onClick={() => setTab('receipts')}
          >
            receipts
          </button>
        </nav>
      </header>
      <main className="main">
        {tab === 'leaderboard' && <Leaderboard />}
        {tab === 'onboarding' && <Onboarding />}
        {tab === 'receipts' && <Receipts />}
      </main>
      <footer className="footer">
        slash-bonded copy-trading on hum. open standard at{' '}
        <a href="https://github.com/damanfi/protocol">damanfi/protocol</a>.
      </footer>
    </div>
  );
}
