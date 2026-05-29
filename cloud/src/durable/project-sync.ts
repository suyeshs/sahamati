/**
 * Durable Object for per-project sync coordination
 */
export class ProjectSyncDO implements DurableObject {
  state: DurableObjectState;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/lock") {
      const lockHolder = await this.state.storage.get<string>("lock_holder");
      const lockExpiry = await this.state.storage.get<number>("lock_expiry");

      if (lockHolder && lockExpiry && Date.now() < lockExpiry) {
        return Response.json({ locked: true, holder: lockHolder }, { status: 409 });
      }

      const { deviceId } = (await request.json()) as { deviceId: string };
      await this.state.storage.put("lock_holder", deviceId);
      await this.state.storage.put("lock_expiry", Date.now() + 30000);

      return Response.json({ locked: false, acquired: true });
    }

    if (url.pathname === "/unlock") {
      await this.state.storage.delete("lock_holder");
      await this.state.storage.delete("lock_expiry");
      return Response.json({ unlocked: true });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
