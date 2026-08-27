import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("desktop shell", () => {
  it("renders the Chinese-first search surface", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /从一个入口/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入关键词、Magnet 或 infohash")).toBeInTheDocument();
    expect(screen.getByText("无中央代理服务")).toBeInTheDocument();
  });

  it("navigates to downloads and shows its empty state", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /下载中/ }));
    expect(screen.getByRole("heading", { name: "下载队列安静待命" })).toBeInTheDocument();
  });

  it("states the privacy boundary in About", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "关于" }));
    expect(screen.getByText(/peers 可以看到你的公网 IP/)).toBeInTheDocument();
    expect(screen.getByText(/并非 TorLink 官方版本/)).toBeInTheDocument();
  });
});

