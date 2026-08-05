import { createRoot } from "react-dom/client";
import App from "./App";
import { ProjectAreasProvider } from "./context/ProjectAreasContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <ProjectAreasProvider>
    <App />
  </ProjectAreasProvider>,
);
