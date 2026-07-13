import { lazy, Suspense } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { AnimatePresence, motion } from "framer-motion";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout, LoadingScreen } from "@/components/layout";
import { MoodProvider } from "@/lib/mood";
import { FilmStateProvider } from "@/lib/filmState";
// Today is the landing route — keep it in the main bundle so first paint
// never waits on a second chunk. Every other page loads on demand.
import Today from "@/pages/today";

const Week = lazy(() => import("@/pages/week"));
const Background = lazy(() => import("@/pages/background"));
const Queue = lazy(() => import("@/pages/queue"));
const Shortlist = lazy(() => import("@/pages/shortlist"));
const Collections = lazy(() => import("@/pages/collections"));
const BlindSpots = lazy(() => import("@/pages/blindspots"));
const Directors = lazy(() => import("@/pages/directors"));
const DirectorDetail = lazy(() => import("@/pages/director-detail"));
const Tracking = lazy(() => import("@/pages/tracking"));
const Canon = lazy(() => import("@/pages/canon"));
const Screenplays = lazy(() => import("@/pages/screenplays"));
const Weeks = lazy(() => import("@/pages/weeks"));
const Craft = lazy(() => import("@/pages/craft"));
const Tags = lazy(() => import("@/pages/tags"));
const NotFound = lazy(() => import("@/pages/not-found"));

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
        <Suspense fallback={<LoadingScreen />}>
          <Switch location={loc}>
            <Route path="/" component={Today} />
            <Route path="/week" component={Week} />
            <Route path="/background" component={Background} />
            <Route path="/queue" component={Queue} />
            <Route path="/shortlist" component={Shortlist} />
            <Route path="/collections" component={Collections} />
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
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

function App() {
  return (
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
  );
}

export default App;
