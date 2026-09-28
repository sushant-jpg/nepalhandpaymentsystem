import { useEffect, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Empty, Loading, Notice, PageTitle, Status } from "../components/Ui";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";

interface NotificationItem {
  _id: string;
  title: string;
  message: string;
  category: string;
  severity: string;
  readAt?: string;
  createdAt: string;
}

interface NotificationResponse {
  items: NotificationItem[];
  unreadCount: number;
  pagination: { page: number; pages: number; total: number };
}

export function NotificationsPage() {
  const [data, setData] = useState<NotificationResponse | null>(null);
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(
        await api.get<NotificationResponse>(
          `/users/notifications?page=${page}&limit=20${unreadOnly ? "&unreadOnly=true" : ""}`,
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Notifications could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [page, unreadOnly]);

  async function markRead(item: NotificationItem) {
    if (!item.readAt) await api.patch(`/users/notifications/${item._id}/read`, {});
    await load();
  }

  async function markAllRead() {
    await api.post("/users/notifications/read-all");
    await load();
  }

  return (
    <>
      <PageTitle
        eyebrow="Inbox"
        title="Notifications"
        description="Payment, refund, verification, merchant, and security updates from your Nepal Hand Pay account."
        action={
          data?.unreadCount ? (
            <button className="btn-secondary" onClick={() => void markAllRead()}>
              <CheckCheck size={17} /> Mark all read
            </button>
          ) : undefined
        }
      />
      <div className="mb-5 flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
              setPage(1);
            }}
            className="accent-forest-600"
          />
          Unread only
        </label>
        {data && <span className="text-xs text-slate-400">{data.unreadCount} unread</span>}
      </div>
      {error && <Notice>{error}</Notice>}
      {loading ? (
        <Loading label="Loading notifications…" />
      ) : data?.items.length ? (
        <div className="space-y-3">
          {data.items.map((item) => (
            <article
              key={item._id}
              className={`card flex items-start gap-4 ${item.readAt ? "" : "border-forest-200 bg-forest-50/40"}`}
            >
              <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-forest-600 shadow-sm">
                <Bell size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-bold text-ink">{item.title}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.message}</p>
                  </div>
                  <Status value={item.severity || item.category} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                  <span>{item.category} · {dateTime(item.createdAt)}</span>
                  {!item.readAt && (
                    <button className="font-semibold text-forest-600" onClick={() => void markRead(item)}>
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty title="No notifications" detail="You’re all caught up." />
      )}
      {data && data.pagination.pages > 1 && (
        <div className="mt-5 flex items-center justify-between text-sm text-slate-500">
          <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button>
          <span>Page {page} of {data.pagination.pages}</span>
          <button className="btn-secondary" disabled={page >= data.pagination.pages} onClick={() => setPage((value) => value + 1)}>Next</button>
        </div>
      )}
    </>
  );
}
