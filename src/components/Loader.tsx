'use client'

import { useEffect, useState, useRef } from 'react'

// A token is either a normal word or an emphasized "punch" word
type Token = {
  word: string
  emphasis?: boolean   // renders bigger, bolder, different color
  pause?: number       // extra ms to hold before next token (default 0)
  color?: string
  italic?: boolean
}

type Scene = {
  tokens: Token[]
  pauseAfter: number   // ms before clearing and moving to next scene
}

const SCENES: Scene[] = [
  {
    tokens: [
      { word: 'Sunday', pause: 80 },
      { word: 'night.', pause: 120 },
      { word: 'Move-in', pause: 80 },
      { word: 'is', pause: 60 },
      { word: 'in', pause: 60 },
      { word: '6 weeks.', emphasis: true, pause: 200, color: '#1a1a1a' },
    ],
    pauseAfter: 600,
  },
  {
    tokens: [
      { word: 'You', pause: 60 },
      { word: 'open', pause: 60 },
      { word: 'Zillow.', emphasis: true, pause: 180 },
      { word: '"Already', pause: 80 },
      { word: 'rented."', pause: 100, color: '#aaa', italic: true },
    ],
    pauseAfter: 500,
  },
  {
    tokens: [
      { word: 'You', pause: 60 },
      { word: 'try', pause: 60 },
      { word: 'Facebook.', emphasis: true, pause: 180 },
      { word: 'No', pause: 60 },
      { word: 'reply.', pause: 100, color: '#aaa', italic: true },
    ],
    pauseAfter: 500,
  },
  {
    tokens: [
      { word: 'The', pause: 60 },
      { word: 'broker', pause: 60 },
      { word: 'fee', pause: 60 },
      { word: 'was', pause: 60 },
      { word: 'HOW', emphasis: true, pause: 160, color: '#1a1a1a' },
      { word: 'much?!', pause: 80 },
    ],
    pauseAfter: 550,
  },
  {
    tokens: [
      { word: 'bro.', emphasis: true, pause: 300, color: '#aaa', italic: true },
    ],
    pauseAfter: 700,
  },
  {
    tokens: [
      { word: 'Finding', pause: 70 },
      { word: 'housing', pause: 70 },
      { word: 'near', pause: 70 },
      { word: 'ASU', emphasis: true, pause: 140 },
      { word: 'is', pause: 70 },
      { word: 'genuinely', pause: 70 },
      { word: 'broken.', emphasis: true, pause: 200, color: '#1a1a1a' },
    ],
    pauseAfter: 500,
  },
  {
    tokens: [
      { word: 'We', pause: 100 },
      { word: 'fixed', pause: 80 },
      { word: 'it.', emphasis: true, pause: 200 },
    ],
    pauseAfter: 700,
  },
  {
    tokens: [
      { word: 'HomeHive', emphasis: true, pause: 300, color: '#8C1D40' },
    ],
    pauseAfter: 700,
  },
  {
    tokens: [
      { word: 'Real', pause: 70 },
      { word: 'homes.', emphasis: true, pause: 140 },
      { word: 'Near', pause: 70 },
      { word: 'ASU.', emphasis: true, pause: 140, color: '#8C1D40' },
    ],
    pauseAfter: 500,
  },
  {
    tokens: [
      { word: 'Zero', pause: 60 },
      { word: 'scams.', emphasis: true, pause: 180, color: '#1a1a1a' },
      { word: 'Zero', pause: 60 },
      { word: 'broker', pause: 60 },
      { word: 'fees.', emphasis: true, pause: 180, color: '#1a1a1a' },
    ],
    pauseAfter: 500,
  },
  {
    tokens: [
      { word: 'Solo', pause: 70 },
      { word: 'or', pause: 70 },
      { word: 'squad —', emphasis: true, pause: 160 },
      { word: "we've", pause: 60 },
      { word: 'got', pause: 60 },
      { word: 'you.', emphasis: true, pause: 200, italic: true },
    ],
    pauseAfter: 800,
  },
]

// How many ms between each token appearing
const TOKEN_INTERVAL = 110

interface LoaderProps {
  onComplete: () => void
}

export default function Loader({ onComplete }: LoaderProps) {
  const [sceneIndex, setSceneIndex] = useState(0)
  const [visibleTokens, setVisibleTokens] = useState(0)
  const [sceneVisible, setSceneVisible] = useState(true)
  const [showEndCard, setShowEndCard] = useState(false)
  const [loaderOut, setLoaderOut] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const skip = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setLoaderOut(true)
    setTimeout(onComplete, 600)
  }

  useEffect(() => {
    if (sceneIndex >= SCENES.length) {
      setShowEndCard(true)
      timerRef.current = setTimeout(() => {
        setLoaderOut(true)
        setTimeout(onComplete, 700)
      }, 1100)
      return
    }

    const scene = SCENES[sceneIndex]
    const tokens = scene.tokens
    setVisibleTokens(0)
    setSceneVisible(true)

    // Reveal tokens one by one, respecting each token's pause
    let tokenIdx = 0
    let elapsed = 0

    const scheduleNext = () => {
      if (tokenIdx >= tokens.length) {
        // All tokens shown — hold then clear
        timerRef.current = setTimeout(() => {
          setSceneVisible(false)
          setTimeout(() => {
            setSceneIndex(i => i + 1)
          }, 260)
        }, scene.pauseAfter)
        return
      }
      const token = tokens[tokenIdx]
      const delay = TOKEN_INTERVAL + (token.pause || 0)
      timerRef.current = setTimeout(() => {
        tokenIdx++
        setVisibleTokens(tokenIdx)
        scheduleNext()
      }, delay)
    }

    scheduleNext()

    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [sceneIndex])

  const scene = sceneIndex < SCENES.length ? SCENES[sceneIndex] : null
  const progress = Math.min((sceneIndex / SCENES.length) * 100, 100)

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,600;1,300;1,600&family=DM+Sans:wght@300;400;500;600&display=swap');

        .loader-wrap {
          position: fixed; inset: 0; background: #fff; z-index: 9999;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          transition: opacity 0.65s ease;
        }
        .loader-wrap.out { opacity: 0; pointer-events: none; }

        .scene-wrap {
          min-height: 160px; max-width: 640px; width: 100%;
          padding: 0 40px; display: flex; align-items: center;
          justify-content: center; flex-wrap: wrap;
          gap: 0 10px; text-align: center;
          transition: opacity 0.25s ease;
        }
        .scene-wrap.hidden { opacity: 0; }

        .token {
          display: inline-block;
          opacity: 0;
          transform: translateY(10px);
          transition: opacity 0.22s ease, transform 0.22s cubic-bezier(0.22,1,0.36,1);
          font-family: 'DM Sans', sans-serif;
          font-size: 22px; font-weight: 300;
          color: #1a1a1a; line-height: 1.4;
          margin: 2px 4px;
        }
        .token.shown { opacity: 1; transform: translateY(0); }
        .token.emphasis {
          font-family: 'Fraunces', serif;
          font-size: 42px; font-weight: 600;
          letter-spacing: -1.5px; line-height: 1.05;
          margin: 0 6px;
        }
        .token.italic { font-style: italic; }

        .end-card {
          display: flex; flex-direction: column;
          align-items: center; gap: 10px;
        }
        .end-title {
          font-family: 'Fraunces', serif;
          font-size: 56px; font-weight: 600; font-style: italic;
          color: #8C1D40; letter-spacing: -2px; line-height: 1.05;
          animation: fadeUp 0.45s ease forwards;
        }
        .end-sub {
          font-family: 'DM Sans', sans-serif;
          font-size: 15px; font-weight: 400; color: #6b6b6b;
          letter-spacing: 0.2px;
          animation: fadeUp 0.45s ease 0.18s both;
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .progress-bar {
          position: absolute; bottom: 0; left: 0; right: 0;
          height: 3px; background: #f0ede6;
        }
        .progress-fill {
          height: 100%; background: #8C1D40;
          transition: width 0.35s ease;
        }
        .skip-btn {
          position: absolute; bottom: 20px; right: 20px;
          background: none; border: none; font-size: 12px;
          color: #ccc; cursor: pointer; font-family: 'DM Sans', sans-serif;
          letter-spacing: 0.5px; padding: 8px; transition: color 0.2s;
        }
        .skip-btn:hover { color: #999; }
      `}</style>

      <div className={`loader-wrap${loaderOut ? ' out' : ''}`}>

        {showEndCard ? (
          <div className="end-card">
            <span className="end-title">HomeHive</span>
            <span className="end-sub">Your home near ASU. No scams. No games.</span>
          </div>
        ) : (
          <div className={`scene-wrap${!sceneVisible ? ' hidden' : ''}`}>
            {scene?.tokens.map((token, i) => (
              <span
                key={`${sceneIndex}-${i}`}
                className={[
                  'token',
                  i < visibleTokens ? 'shown' : '',
                  token.emphasis ? 'emphasis' : '',
                  token.italic ? 'italic' : '',
                ].filter(Boolean).join(' ')}
                style={{
                  color: token.color || undefined,
                }}
              >
                {token.word}
              </span>
            ))}
          </div>
        )}

        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <button className="skip-btn" onClick={skip}>skip →</button>
      </div>
    </>
  )
}
