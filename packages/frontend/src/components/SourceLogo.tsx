"use client";

import styled from "styled-components";
import { LOCAL_SOURCE_LOGOS } from "@/lib/clientRegistry";

interface SourceLogoProps {
  sourceId: string;
  height?: number;
  className?: string;
}

const StyledImg = styled.img<{ $height: number }>`
  border-radius: 2px;
  object-fit: contain;
  height: ${props => props.$height}px;
  width: auto;
  min-width: ${props => props.$height}px;
  max-width: ${props => props.$height}px;
  min-height: ${props => props.$height}px;
  max-height: ${props => props.$height}px;
`;

export function SourceLogo({ sourceId, height = 14, className = "" }: SourceLogoProps) {
  const normalizedId = sourceId.toLowerCase();
  const src = LOCAL_SOURCE_LOGOS[normalizedId as keyof typeof LOCAL_SOURCE_LOGOS] ?? null;

  if (!src) {
    return <span className={className}>{sourceId}</span>;
  }

  return (
    <StyledImg
      src={src}
      alt={sourceId}
      $height={height}
      className={className}
    />
  );
}
