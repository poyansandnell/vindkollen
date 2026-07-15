import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PwaUpdateBanner } from "@/components/PwaUpdateBanner";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import PlaceTurbines from "@/pages/PlaceTurbines";
import MyProjects from "@/pages/MyProjects";
import About from "@/pages/About";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";
import Contact from "@/pages/Contact";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/placera" component={PlaceTurbines} />
      <Route path="/mina-projekt" component={MyProjects} />
      <Route path="/om" component={About} />
      <Route path="/integritetspolicy" component={Privacy} />
      <Route path="/villkor" component={Terms} />
      <Route path="/kontakt" component={Contact} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
        <PwaUpdateBanner />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
