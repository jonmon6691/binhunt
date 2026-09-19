import { FC, useState } from 'react';

interface SpacegrepLogoProps {
  className?: string;
  href?: string;
}

export const SpacegrepLogo: FC<SpacegrepLogoProps> = ({
  className = '',
  href = 'https://github.com/jonmon6691/spacegrep',
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const Tag = href ? 'a' : 'div';
  const linkProps = href
    ? {
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        title: 'View spacegrep on GitHub',
      }
    : {};

  return (
    <Tag
      {...linkProps}
      className={`group/sg relative h-full flex items-center select-none cursor-pointer overflow-hidden no-underline transition-[width] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isHovered
          ? 'w-[245px] sm:w-[270px]'
          : 'w-[50px] sm:w-[55px] hover:w-[245px] sm:hover:w-[270px]'
      } ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-hovered={isHovered ? 'true' : 'false'}
      role="img"
      aria-label="spacegrep logo"
      style={{
        transform: 'translateZ(0)',
        willChange: 'width',
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style>{`
        .sg-text {
          font-family: Rockwell, 'Rockwell Nova', 'Arial Black', serif;
          font-size: 580px;
          font-weight: normal;
          letter-spacing: -12px;
          fill: #FFFFFF;
          stroke: none;
          opacity: 0;
          transition: opacity 0.25s ease-out;
          pointer-events: none;
          text-rendering: geometricPrecision;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          transform: translateZ(0);
        }

        /* Drawer S handle closes on hover */
        .sg-handle-s {
          transition: transform 0.32s cubic-bezier(0.2, 0.9, 0.3, 1);
        }
        .group\\/sg:hover .sg-handle-s,
        .group\\/sg[data-hovered="true"] .sg-handle-s {
          transform: translateY(-62px);
        }

        /* Drawer G handle stays open at all times */
        .sg-handle-g {
          transform: translateY(0);
        }

        /* Letter G slides across to make room for 'pace' */
        .sg-letter-g {
          transition: transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .group\\/sg:hover .sg-letter-g,
        .group\\/sg[data-hovered="true"] .sg-letter-g {
          transform: translateX(1445px);
        }

        /* 'pace' and 'rep' real text reveal smoothly without position shift */
        .group\\/sg:hover .sg-text,
        .group\\/sg[data-hovered="true"] .sg-text {
          opacity: 1;
        }
      `}</style>
      <svg
        viewBox="185 240 3320 545"
        preserveAspectRatio="xMinYMid meet"
        fill="#FFFFFF"
        fillRule="evenodd"
        xmlns="http://www.w3.org/2000/svg"
        className="h-full w-auto flex-shrink-0"
        style={{
          transform: 'translateZ(0)',
          textRendering: 'geometricPrecision',
          shapeRendering: 'geometricPrecision',
        }}
      >
        {/* Letter S (Drawer unit with closing pull handle) */}
        <g id="letter-s">
          <g className="sg-handle-s">
            <path d="M 238.0 584.0 L 238.0 664.0 A 22 22 0 0 0 260.0 686.0 L 432.0 686.0 A 22 22 0 0 0 454.0 664.0 L 454.0 584.0 L 418.0 584.0 L 418.0 638.0 A 10 10 0 0 1 408.0 648.0 L 284.0 648.0 A 10 10 0 0 1 274.0 638.0 L 274.0 584.0 Z" />
          </g>
          <path d="M 258 485 C 266 498, 254 522, 270 532 C 281 539, 300 541, 311 542 C 345 545, 365 545, 397 538 C 420 533, 422 505, 413 488 C 410 483, 404 479, 399 477 C 367 467, 357 471, 318 467 C 303 465, 288 464, 274 460 C 233 449, 205 420, 202 378 C 201 362, 201 348, 205 333 C 219 275, 277 254, 331 254 L 482 254 L 482 378 L 423 378 C 421 345, 384 324, 345 324 C 290 324, 268 346, 277 375 C 283 392, 305 396, 327 398 C 376 404, 434 399, 472 438 C 487 453, 495 479, 495 500 L 495 610 A 8 8 0 0 1 487 618 L 471 618 A 5 5 0 0 1 466 613 L 466 584 L 227 584 L 227 613 A 5 5 0 0 1 222 618 L 206 618 A 8 8 0 0 1 198 610 L 198 488 Z" />
        </g>

        {/* Real text 'pace' between S and G */}
        <text x="520" y="584" className="sg-text">
          pace
        </text>

        {/* Letter G (Drawer unit - drawer stays open!) */}
        <g className="sg-letter-g">
          <g className="sg-handle-g">
            <path d="M 571.0 678.0 L 571.0 749.0 A 22 22 0 0 0 593.0 771.0 L 769.0 771.0 A 22 22 0 0 0 791.0 749.0 L 791.0 678.0 L 755.0 678.0 L 755.0 722.0 A 10 10 0 0 1 745.0 732.0 L 617.0 732.0 A 10 10 0 0 1 607.0 722.0 L 607.0 678.0 Z" />
          </g>
          <path d="M 680 254 L 847 254 L 847 332 L 818 332 L 818 644 L 847 644 L 847 707 A 8 8 0 0 1 839 715 L 820 715 A 5 5 0 0 1 815 710 L 815 678 L 547 678 L 547 710 A 5 5 0 0 1 542 715 L 523 715 A 8 8 0 0 1 515 707 L 515 644 L 740 644 L 740 580 C 724 598, 695 612, 656 612 C 590 612, 515 570, 515 426 C 515 320, 580 254, 680 254 Z M 680 326 C 630 326, 595 365, 595 435 C 595 505, 630 542, 680 542 C 730 542, 742 505, 742 435 C 742 365, 730 326, 680 326 Z" />
        </g>

        {/* Real text 'rep' following G */}
        <text x="2330" y="584" className="sg-text">
          rep
        </text>
      </svg>
    </Tag>
  );
};
