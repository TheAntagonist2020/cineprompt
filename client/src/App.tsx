import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { AnimatePresence, motion } from "framer-motion";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { MoodProvider } from "@/lib/mood";
import { FilmStateProvider } from "@/lib/filmState";
import Today from "@/pages/today";
import Week from "@/pages/week";
import Background from "@/pages/background";
import Queue from "@/pages/queue";
import Shortlist from "@/pages/shortlist";
import BlindSpots from "@/pages/blindspots";
import Directors from "@/pages/directors";
import DirectorDetail from "@/pages/director-detail";
import Tracking from "@/pages/tracking";
import Canon from "@/pages/canon";
import Screenplays from "@/pages/screenplays";
import Weeks from "@/pages/weeks";
import Craft from "@/pages/craft";
import Tags from "@/pages/tags";
import NotFound from "@/pages/not-found";

function AppRouter() {
  const [loc] = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={loc}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.4, 0.0, 0.2, 1] }}
      >
        <Switch location={loc}>
          <Route path="/" component={Today} />
          <Route path="/week" component={Week} />
          <Route path="/background" component={Background} />
          <Route path="/queue" component={Queue} />
          <Route path="/shortlist" component={Shortlist} />
          <Route path="/blindspots" component={BlindSpots} />
          <Route path="/directors" component={Directors} />
          <Route path="/directors/:name" component={DirectorDetail} />
          <Route path="/tracking" component={Tracking} />
          <Route path="/canon" component={Canon} />
          <Route path="/screenplays" component={Screenplays} />
          <Route path="/weeks" component={Weeks} />
          <Route path="/craft" component={Craft} />
          <Route path="/tags" component={Tags} />
          <Route component={NotFound} />
        </Switch>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <FilmStateProvider>
          <MoodProvider>
            <Router hook={useHashLocation}>
              <Layout>
                <AppRouter />
              </Layout>
            </Router>
          </MoodProvider>
        </FilmStateProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
