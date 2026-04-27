import { Component } from "solid-js";

export interface LoadingIndicatorProps {
  text?: string;
}

const LoadingIndicator: Component<LoadingIndicatorProps> = (props) => {
  return (
    <div class="loading-indicator">
      <div class="loading-dots">
        <div class="dot" />
        <div class="dot" />
        <div class="dot" />
      </div>
      <span class="loading-text">{props.text || "Thinking..."}</span>
    </div>
  );
};

export default LoadingIndicator;
