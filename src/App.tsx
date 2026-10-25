import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { Shell } from './components/Shell';
import { AssetPage } from './pages/AssetPage';
import { CreatePage } from './pages/CreatePage';
import { EarningsPage } from './pages/EarningsPage';
import { LandingPage } from './pages/LandingPage';
import { LibraryPage } from './pages/LibraryPage';
import { LoginPage } from './pages/LoginPage';
import { MarketPage } from './pages/MarketPage';
import { PlansPage } from './pages/PlansPage';
import { RightsPage } from './pages/RightsPage';
import { StudioPage } from './pages/StudioPage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Shell />}>
            <Route path="/create" element={<CreatePage />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/market" element={<MarketPage />} />
            <Route path="/market/:id" element={<MarketPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/library/:id" element={<AssetPage />} />
            <Route path="/rights" element={<RightsPage />} />
            <Route path="/earnings" element={<EarningsPage />} />
            <Route path="/plans" element={<PlansPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
