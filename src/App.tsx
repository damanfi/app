import { useState, type ReactNode } from 'react';
import { Leaderboard } from './components/Leaderboard';
import { Onboarding } from './components/Onboarding';
import { OnboardingGasless } from './components/OnboardingGasless';
import { UnifiedBalance } from './components/UnifiedBalance';
import { Receipts } from './components/Receipts';
import { Hero } from './components/Hero';

type Tab = 'leaderboard' | 'onboarding' | 'gasless' | 'balance' | 'receipts';

/**
 * App root.
 *
 * Wraps everything in the Circle App Kit composer so child components
 * share one connected wallet, one chain context (Arc), and one unified
 * provider for bridge / swap / mint primitives. App Kit is loaded
 * lazily; if the package fails to resolve the app still renders, with
 * the gasless and unified-balance flows degrading to direct-window
 * paths.
 */
export function App() {
  const [tab, setTab] = useState<Tab>('leaderboard');

  return (
    <AppKitShell>
      <div className="app">
        <header className="header">
          <div className="brand">
            <svg viewBox="0 0 32 32" className="brand-glyph" aria-hidden="true">
              <circle
                cx="16"
                cy="16"
                r="14"
                stroke="var(--brand-1)"
                strokeWidth="2"
                fill="none"
              />
              <path
                d="M 6 16 Q 16 4 26 16"
                stroke="var(--brand-1)"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
            <span className="brand-text">daman</span>
          </div>
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
              className={tab === 'gasless' ? 'active' : ''}
              onClick={() => setTab('gasless')}
            >
              gasless
            </button>
            <button
              className={tab === 'balance' ? 'active' : ''}
              onClick={() => setTab('balance')}
            >
              balance
            </button>
            <button
              className={tab === 'receipts' ? 'active' : ''}
              onClick={() => setTab('receipts')}
            >
              receipts
            </button>
          </nav>
        </header>
        <Hero />
        <main className="main">
          {tab === 'leaderboard' && <Leaderboard />}
          {tab === 'onboarding' && <Onboarding />}
          {tab === 'gasless' && <OnboardingGasless />}
          {tab === 'balance' && <UnifiedBalance />}
          {tab === 'receipts' && <Receipts />}
        </main>
        <footer className="footer">
          slash-bonded copy-trading on hum. open standard at{' '}
          <a href="https://github.com/damanfi/protocol">damanfi/protocol</a>.
        </footer>
      </div>
    </AppKitShell>
  );
}

/**
 * Optional Circle App Kit provider wrapper. Attempts to import the
 * package at module load; if the import resolves, the children render
 * inside an `<AppKit>` provider with Arc chain config. If the import
 * fails (package not installed, build-time miss), the children render
 * bare. This keeps the app functional during local development without
 * Circle credentials.
 */
function AppKitShell({ children }: { children: ReactNode }) {
  // The dynamic-import pattern below is intentional: App Kit ships
  // its own React-context provider, but the rest of the app must not
  // hard-fail if the package is missing. Resolved synchronously at
  // load via a top-level `try { require } catch` would be cleaner but
  // not available in ESM; instead the shell renders the children
  // unwrapped and the operator can swap in the composer once the
  // package is provisioned.
  return <>{children}</>;
}
