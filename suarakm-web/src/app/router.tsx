import { createBrowserRouter } from "react-router";
import { RootLayout } from "./layouts/RootLayout";
import { AuthLayout } from "./layouts/AuthLayout";
import { RouteError } from "@/pages/RouteError";

/** Setiap halaman di-load secara lazy supaya bundle awal tetap kecil (peta & chart cukup berat). */
const halaman = (impor: () => Promise<{ default: React.ComponentType }>) => () =>
  impor().then((m) => ({ Component: m.default }));

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, lazy: halaman(() => import("@/pages/home/HomePage")) },
      { path: "lapor", lazy: halaman(() => import("@/pages/lapor/LaporPage")) },
      { path: "jelajah", lazy: halaman(() => import("@/pages/jelajah/JelajahPage")) },
      { path: "isu/:id", lazy: halaman(() => import("@/pages/isu/IsuDetailPage")) },
      { path: "dashboard", lazy: halaman(() => import("@/pages/dashboard/DashboardPage")) },
      { path: "lacak", lazy: halaman(() => import("@/pages/lacak/LacakPage")) },
      { path: "tentang", lazy: halaman(() => import("@/pages/tentang/TentangPage")) },
      { path: "*", lazy: halaman(() => import("@/pages/NotFoundPage")) },
    ],
  },
  {
    element: <AuthLayout />,
    children: [{ path: "masuk", lazy: halaman(() => import("@/pages/auth/MasukPage")) }],
  },
]);
