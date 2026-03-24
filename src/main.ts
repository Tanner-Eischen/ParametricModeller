import { App } from './App';
import { logger } from './core';

// Set log level based on environment
if (import.meta.env.DEV) {
  logger.setLevel('debug');
} else {
  logger.setLevel('info');
}

// Initialize app when DOM is ready
function init() {
  const appContainer = document.getElementById('app');

  if (!appContainer) {
    console.error('App container not found');
    return;
  }

  const app = new App(appContainer);

  // Store app instance for debugging
  if (import.meta.env.DEV) {
    (window as Window & { app?: App }).app = app;
  }

  logger.info('Parametric Modeler started');
}

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
