import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { AssetPage } from './pages/AssetPage';
import { CreatePage } from './pages/CreatePage';
import { EarningsPage } from './pages/EarningsPage';
import { LibraryPage } from './pages/LibraryPage';
import { MarketPage } from './pages/MarketPage';
import { RightsPage } from './pages/RightsPage';
import { StudioPage } from './pages/StudioPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/studio" replace />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/market/:id" element={<MarketPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/library/:id" element={<AssetPage />} />
          <Route path="/rights" element={<RightsPage />} />
          <Route path="/earnings" element={<EarningsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
