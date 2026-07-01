import '@fontsource/press-start-2p'; // registers the @font-face for our pixel UI font
import { bootGame } from './app/bootGame.js';

bootGame().catch((error) => {
  console.error('Could not boot the game', error);
});
