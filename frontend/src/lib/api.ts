const API = 'http://localhost:3001';

async function fetchApi(path: string, options?: RequestInit) {
  const token = (window as any).__clerk_token;
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// Auth
export async function register(name: string, email: string, password: string) {
  return fetchApi('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export async function login(email: string, password: string) {
  return fetchApi('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// Groups
export async function getGroups() {
  return fetchApi('/api/groups');
}

export async function createGroup(name: string, description: string, memberIds: number[]) {
  return fetchApi('/api/groups', {
    method: 'POST',
    body: JSON.stringify({ name, description, member_ids: memberIds }),
  });
}

export async function getGroup(id: number) {
  return fetchApi(`/api/groups/${id}`);
}

export async function getGroupBalances(id: number) {
  return fetchApi(`/api/groups/${id}/balances`);
}

export async function getGroupMembers(id: number) {
  return fetchApi(`/api/groups/${id}/members`);
}

// Expenses
export async function getExpenses(groupId: number) {
  return fetchApi(`/api/expenses/group/${groupId}`);
}

export async function createExpense(data: {
  group_id: number;
  amount: number;
  description: string;
  date?: string;
  splits: { user_id: number; amount?: number; percentage?: number }[];
}) {
  return fetchApi('/api/expenses', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// Settlements
export async function getSettlements(groupId: number) {
  return fetchApi(`/api/settlements/group/${groupId}`);
}

export async function createSettlement(data: {
  group_id: number;
  from_user: number;
  to_user: number;
  amount: number;
  date?: string;
}) {
  return fetchApi('/api/settlements', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}