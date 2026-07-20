import { Switch, Route, Router as WouterRouter } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaUpdateBanner } from "@/components/PwaUpdateBanner";
import { isNative } from "@/lib/capacitorBridge";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import PlaceTurbines from "@/pages/PlaceTurbines";
import PdfViewer from "@/pages/PdfViewer";
import MyProjects from "@/pages/MyProjects";
import About from "@/pages/About";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Contact from "@/pages/Contact";
import AppStoreScreenshots from "@/pages/AppStoreScreenshots";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/placera" component={PlaceTurbines} />
      <Route path="/pdf-viewer" component={PdfViewer} />
      <Route path="/mina-projekt" component={MyProjects} />
      <Route path="/om" component={About} />
      <Route path="/integritetspolicy" component={Privacy} />
      <Route path="/villkor" component={Terms} />
      <Route path="/kontakt" component={Contact} />
      <Route path="/appstore-screenshots" component={AppStoreScreenshots} />
      <Route component={NotFound} />
    </Switch>
  );
}

const _isNative = isNative();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {_isNative ? (
          /*
           * Native (iOS/Android via Capacitor): hash-baserad routing.
           * Capacitor serverar appen från capacitor://localhost/ och kan inte
           * hantera path-baserad navigation som /placera → 404.
           * Hash-routing (/#/, /#/placera) fungerar korrekt i WKWebView.
           */
          <WouterRouter hook={useHashLocation}>
            <Router />
          </WouterRouter>
        ) : (
          /*
           * Webb: path-baserad routing med BASE_URL-prefix (Replit-proxy).
           */
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        )}
        <Toaster />
        {!_isNative && <PwaUpdateBanner />}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
