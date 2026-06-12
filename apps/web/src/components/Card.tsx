import { motion } from 'framer-motion';
import { CARD_NAMES, type Card as CardModel, type CardType } from '@ek/shared';
import { CARD_VISUALS } from '../data/cardVisuals.js';

interface CardProps {
  type: CardType;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
  layoutId?: string;
  small?: boolean;
}

export function Card({ type, selectable, selected, onClick, layoutId, small }: CardProps) {
  const v = CARD_VISUALS[type];
  return (
    <motion.div
      layoutId={layoutId}
      className={`card ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''}`}
      style={{
        background: v.gradient,
        transform: small ? 'scale(0.7)' : undefined,
      }}
      onClick={onClick}
      whileHover={selectable ? { y: -28, scale: 1.04, zIndex: 5 } : undefined}
      animate={selected ? { y: -28 } : { y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
    >
      <span className="corner">{v.emoji.slice(0, 2)}</span>
      <span className="emoji">{v.emoji}</span>
      <span className="name">{CARD_NAMES[type]}</span>
    </motion.div>
  );
}

/** Convenience wrapper that takes a full Card model (id-keyed). */
export function CardFace({ card, ...rest }: { card: CardModel } & Omit<CardProps, 'type'>) {
  return <Card type={card.type} {...rest} />;
}

export function CardBack({ count }: { count?: number }) {
  return (
    <div className="card back">
      <span className="paw">🐾</span>
      {count !== undefined && <span className="name">{count} left</span>}
    </div>
  );
}
