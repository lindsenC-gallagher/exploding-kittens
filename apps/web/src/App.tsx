import { Route, Routes } from 'react-router-dom';
import { Home } from './pages/Home.js';
import { Room } from './pages/Room.js';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/room/:code" element={<Room />} />
    </Routes>
  );
}
