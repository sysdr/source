
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { hydrateFromDB } from './services/dbSync';
import { seedDefaultOrganisationIfNeeded } from './services/defaultOrganisation';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// Hydrate localStorage from the SQLite database before mounting the app.
// This ensures data persisted from previous sessions is available on first render.
// If the server is unreachable the app falls back to whatever is already in localStorage.
hydrateFromDB().finally(() => {
  seedDefaultOrganisationIfNeeded();
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
