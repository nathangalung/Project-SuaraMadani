import { Outlet, ScrollRestoration } from "react-router";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { ChatBubble } from "@/components/layout/ChatBubble";

export function RootLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#konten"
        className="sr-only z-[2000] bg-km-navy px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Lewati ke konten
      </a>
      <Navbar />
      <main id="konten" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <ChatBubble />
      <ScrollRestoration />
    </div>
  );
}
