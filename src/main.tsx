import { createRoot } from 'react-dom/client';
import { App } from './App';
import { primeSDK } from './runanywhere';
import './styles/app.css';

// Register Service Worker for offline capability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then((registration) => {
        console.log('ServiceWorker registered:', registration.scope);
      })
      .catch((error) => {
        console.error('ServiceWorker registration failed:', error);
      });
  });
}
// 2. Clear Screen and Render App
// (We don't use StrictMode as it causes double-initialization of the AI WASM singletons)
createRoot(document.getElementById('root')!).render(<App />);

// 3. Prime only the lightweight SDK core after first paint.
primeSDK();
