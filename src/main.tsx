import React from 'react';
import ReactDOM from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import { App } from './App';
import './styles.css';

// SPA fallback restore. When 404.html bounces an unknown path to the
// SPA shell as ?p=/cinematic, this restores the real path before React
// mounts so the route detector sees the intended URL. See public/404.html.
(function restoreSpaPath() {
  const l = window.location;
  if (l.search && l.search.indexOf('p=') > -1) {
    const params = new URLSearchParams(l.search);
    const p = params.get('p');
    const q = params.get('q');
    if (p !== null) {
      const base = (import.meta as any).env?.BASE_URL ?? '/';
      const restored =
        base.replace(/\/$/, '') +
        p.replace(/~and~/g, '&') +
        (q ? '?' + q.replace(/~and~/g, '&') : '') +
        l.hash;
      window.history.replaceState(null, '', restored);
    }
  }
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Theme appearance="dark" accentColor="amber" grayColor="mauve" radius="medium" scaling="100%">
      <App />
    </Theme>
  </React.StrictMode>
);
