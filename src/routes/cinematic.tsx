// /cinematic route. Renders the player edge-to-edge with no app chrome.
// Imported by App.tsx and switched in on path match.

import { CinematicPlayer } from '../components/CinematicPlayer';
import '../styles/cinematic.css';

export function CinematicRoute() {
  return <CinematicPlayer />;
}
