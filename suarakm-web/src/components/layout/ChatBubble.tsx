import { useLocation } from "react-router";
import { MessageCircle } from "lucide-react";
import { SITE } from "@/constants/site";

/** Rute yang punya tombol aksi di bawah layar — tombol chat disembunyikan agar tidak menutupinya */
const DISEMBUNYIKAN = ["/lapor"];

/** Tombol "Chat" di pojok kanan bawah (wireframe dashboard) */
export function ChatBubble() {
  const { pathname } = useLocation();
  if (DISEMBUNYIKAN.some((r) => pathname.startsWith(r))) return null;

  return (
    <a
      href={`mailto:${SITE.kontak.email}?subject=Pertanyaan%20SuaraKM`}
      aria-label="Tanya tim SuaraKM lewat email"
      className="fixed right-4 bottom-4 z-[900] flex items-center gap-2 rounded-[10px] bg-km-blue p-3.5 font-judul text-white shadow-tombol hover:bg-biru-600 transition-transform hover:-translate-y-0.5 sm:right-6 sm:bottom-6 sm:px-5 sm:py-3"
    >
      <MessageCircle className="size-5" aria-hidden />
      <span className="hidden sm:inline">Chat</span>
    </a>
  );
}
