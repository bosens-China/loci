/**
 * Loci 品牌图标：支持随界面浅色 / 深色主题自动适配页纸与纹理配色。
 */
export function LociLogo({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      role="img"
      aria-label="Loci"
      className={className}
    >
      <defs>
        <linearGradient
          id="loci-bookmark"
          x1="616"
          y1="152"
          x2="764"
          y2="444"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#38BDF8" />
          <stop offset="1" stopColor="#1677FF" />
        </linearGradient>
      </defs>

      {/* 底层副页：浅色为冰蓝，深色为深海军蓝 */}
      <rect
        x="156"
        y="108"
        width="600"
        height="752"
        rx="92"
        className="fill-[#DBEAFE] dark:fill-[#172554]"
      />

      {/* 主文档页：浅色为白底蓝边，深色为深蓝底亮蓝边 */}
      <rect
        x="248"
        y="164"
        width="620"
        height="752"
        rx="92"
        strokeWidth="24"
        className="fill-[#F8FAFF] stroke-[#93C5FD] dark:fill-[#1E293B] dark:stroke-[#2563EB]"
      />

      {/* 顶部嵌入式书签 */}
      <path
        d="M612 152h148a20 20 0 0 1 20 20v252c0 16-18 25-31 15l-53-42a16 16 0 0 0-20 0l-53 42c-13 10-31 1-31-15V172a20 20 0 0 1 20-20Z"
        fill="url(#loci-bookmark)"
      />

      {/* 极简文档结构线 */}
      <rect
        x="348"
        y="344"
        width="188"
        height="48"
        rx="24"
        className="fill-[#60A5FA] dark:fill-[#3B82F6]"
      />
      <rect
        x="348"
        y="556"
        width="416"
        height="48"
        rx="24"
        className="fill-[#BFDBFE] dark:fill-[#334155]"
      />
      <rect
        x="348"
        y="680"
        width="288"
        height="48"
        rx="24"
        className="fill-[#BFDBFE] dark:fill-[#334155]"
      />
    </svg>
  )
}
