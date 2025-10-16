import React from 'react';
import ReactDOM from 'react-dom/client';
import { NavigationProvider } from './contexts/NavigationContext';
import LandingPage from './components/LandingPage';
import './index.css';

ReactDOM.createRoot(document.getElementById('landing-root')!).render(
  <React.StrictMode>
    <NavigationProvider initialModule="login">
      <LandingPage />
    </NavigationProvider>
  </React.StrictMode>
);
