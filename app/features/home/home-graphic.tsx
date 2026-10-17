import { useId } from "react"
import { Rings, StarPair } from "./ornaments"

// Mockup GrafikSuara, KM ITB only
export function HomeGraphic() {
  const fill = `${useId()}bubble`
  return (
    <div aria-hidden="true" className="relative aspect-square w-full">
      <Rings
        priority
        className="absolute -inset-[8%] h-[116%] w-[116%] max-w-none"
      />
      <StarPair
        sizes="11rem"
        className="absolute -top-[6%] left-0 h-auto w-[34%] max-w-none"
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 400 360"
        className="absolute top-[16%] left-[8%] w-[82%] -rotate-6 overflow-visible drop-shadow-[0_18px_22px_rgb(8_38_110/0.28)]"
      >
        <defs>
          <linearGradient id={fill} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#3f8ef7" />
            <stop offset="1" stopColor="#176bff" />
          </linearGradient>
        </defs>
        <path
          d="M74 36 H306 A44 44 0 0 1 350 80 V214 A44 44 0 0 1 306 258 H156 L88 322 L104 258 H74 A44 44 0 0 1 30 214 V80 A44 44 0 0 1 74 36 Z"
          fill={`url(#${fill})`}
          stroke="#fff"
          strokeWidth="8"
          strokeLinejoin="round"
        />
        <g fill="#fff">
          <rect x="78" y="88" width="196" height="20" rx="10" />
          <rect x="78" y="130" width="228" height="20" rx="10" opacity="0.8" />
          <rect x="78" y="172" width="150" height="20" rx="10" opacity="0.6" />
        </g>
        <circle
          cx="336"
          cy="252"
          r="54"
          fill="#ffe030"
          stroke="#fff"
          strokeWidth="8"
        />
        <path
          d="M310 252 L330 272 L364 234"
          fill="none"
          stroke="#08266e"
          strokeWidth="13"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
