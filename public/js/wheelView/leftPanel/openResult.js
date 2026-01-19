import { setState } from "../../shared/state.js";

export function openResult(item) {
  setState({
    result: { item: item || null, updatedAt: Date.now() },
  });
}
