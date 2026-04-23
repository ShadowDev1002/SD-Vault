import React from 'react';
import ReactDOM from 'react-dom/client';
import './App.css';
import App from './App';
import { initTheme, initAccent } from './utils/theme';

initTheme();
initAccent();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
