import request from "supertest";
import { createApp } from "./app";
import { TodoService } from "./services/todoService";
import type { Express } from "express";

describe("Todos API", () => {
  let app: Express;
  let todoService: TodoService;

  beforeEach(() => {
    todoService = new TodoService();
    app = createApp({ todoService });
  });

  describe("POST /todos", () => {
    it("should create a new todo", async () => {
      const response = await request(app)
        .post("/todos")
        .send({ title: "Test Todo", description: "Test description" })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.title).toBe("Test Todo");
      expect(response.body.description).toBe("Test description");
      expect(response.body.completed).toBe(false);
      expect(response.body.createdAt).toBeDefined();
      expect(response.body.updatedAt).toBeDefined();
    });

    it("should create todo without description", async () => {
      const response = await request(app)
        .post("/todos")
        .send({ title: "Test Todo" })
        .expect(201);

      expect(response.body.title).toBe("Test Todo");
      expect(response.body.description).toBeUndefined();
    });

    it("should return 400 for missing title", async () => {
      const response = await request(app).post("/todos").send({}).expect(400);

      expect(response.body.error).toContain("Title is required");
    });

    it("should return 400 for empty title", async () => {
      const response = await request(app)
        .post("/todos")
        .send({ title: "   " })
        .expect(400);

      expect(response.body.error).toContain("Title cannot be empty");
    });

    it("should return 400 for title exceeding max length", async () => {
      const longTitle = "a".repeat(201);
      const response = await request(app)
        .post("/todos")
        .send({ title: longTitle })
        .expect(400);

      expect(response.body.error).toContain(
        "Title cannot exceed 200 characters",
      );
    });

    it("should return 400 for non-string title", async () => {
      const response = await request(app)
        .post("/todos")
        .send({ title: 123 })
        .expect(400);

      expect(response.body.error).toContain("must be a string");
    });

    it("should return 400 for invalid description", async () => {
      const response = await request(app)
        .post("/todos")
        .send({ title: "Test", description: 123 })
        .expect(400);

      expect(response.body.error).toContain("Description must be a string");
    });
  });

  describe("GET /todos", () => {
    it("should return empty array when no todos", async () => {
      const response = await request(app).get("/todos").expect(200);

      expect(response.body).toEqual([]);
    });

    it("should return all todos", async () => {
      await request(app).post("/todos").send({ title: "Todo 1" });
      await request(app).post("/todos").send({ title: "Todo 2" });
      await request(app).post("/todos").send({ title: "Todo 3" });

      const response = await request(app).get("/todos").expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body[0].title).toBe("Todo 1");
      expect(response.body[1].title).toBe("Todo 2");
      expect(response.body[2].title).toBe("Todo 3");
    });

    it("should filter todos by completed and priority", async () => {
      const doneLow = await request(app).post("/todos").send({
        title: "Done Low",
        priority: "low",
      });
      const openHigh = await request(app).post("/todos").send({
        title: "Open High",
        priority: "high",
      });

      await request(app)
        .put(`/todos/${doneLow.body.id}`)
        .send({ completed: true })
        .expect(200);

      await request(app)
        .put(`/todos/${openHigh.body.id}`)
        .send({ completed: false })
        .expect(200);

      const response = await request(app)
        .get("/todos")
        .query({ completed: "true", priority: "low" })
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe("Done Low");
    });

    it("should paginate sorted todos", async () => {
      await request(app).post("/todos").send({ title: "Zulu" });
      await request(app).post("/todos").send({ title: "Alpha" });
      await request(app).post("/todos").send({ title: "Mike" });

      const response = await request(app)
        .get("/todos")
        .query({ sortBy: "title", sortOrder: "asc", page: "2", limit: "1" })
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe("Mike");
    });

    it("should return todos in creation order with sortBy=order and sortOrder=asc", async () => {
      await request(app).post("/todos").send({ title: "First" });
      await request(app).post("/todos").send({ title: "Second" });
      await request(app).post("/todos").send({ title: "Third" });

      const response = await request(app)
        .get("/todos")
        .query({ sortBy: "order", sortOrder: "asc" })
        .expect(200);

      expect(response.body).toHaveLength(3);
      expect(response.body[0].title).toBe("First");
      expect(response.body[1].title).toBe("Second");
      expect(response.body[2].title).toBe("Third");
    });

    it("should filter by exact category match only", async () => {
      await request(app)
        .post("/todos")
        .send({ title: "Parent task", category: "Work" });
      await request(app)
        .post("/todos")
        .send({ title: "Child task", category: "Work / Backend" });
      await request(app)
        .post("/todos")
        .send({ title: "Other task", category: "Home" });

      const response = await request(app)
        .get("/todos")
        .query({ category: "Work" })
        .expect(200);

      // Backend does exact match — "Work / Backend" is NOT included.
      // Hierarchical matching is handled client-side today.
      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe("Parent task");
    });

    it("should filter by project prefix and search query", async () => {
      await request(app)
        .post("/todos")
        .send({ title: "Ship report", category: "Work" });
      await request(app)
        .post("/todos")
        .send({ title: "Backend report", category: "Work / Backend" });
      await request(app)
        .post("/todos")
        .send({ title: "Home report", category: "Home" });

      const response = await request(app)
        .get("/todos")
        .query({ project: "Work", search: "report" })
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(
        response.body.map((todo: { title: string }) => todo.title),
      ).toEqual(expect.arrayContaining(["Ship report", "Backend report"]));
    });

    it("should filter by unsorted flag and due date window", async () => {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      await request(app)
        .post("/todos")
        .send({ title: "Loose today", dueDate: todayStart.toISOString() });
      await request(app).post("/todos").send({
        title: "Project today",
        category: "Work",
        dueDate: todayStart.toISOString(),
      });
      await request(app)
        .post("/todos")
        .send({
          title: "Loose later",
          dueDate: new Date(todayEnd.getTime() + 86400000).toISOString(),
        });

      const response = await request(app)
        .get("/todos")
        .query({
          unsorted: "true",
          dueDateFrom: todayStart.toISOString(),
          dueDateTo: todayEnd.toISOString(),
        })
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe("Loose today");
    });

    it("should return 400 for invalid todo list query", async () => {
      const response = await request(app)
        .get("/todos")
        .query({ completed: "yes" })
        .expect(400);

      expect(response.body.error).toContain(
        'completed must be "true" or "false"',
      );
    });
  });

  describe("GET /todos/:id", () => {
    it("should return todo by ID", async () => {
      const createResponse = await request(app)
        .post("/todos")
        .send({ title: "Test Todo" });

      const id = createResponse.body.id;

      const response = await request(app).get(`/todos/${id}`).expect(200);

      expect(response.body.id).toBe(id);
      expect(response.body.title).toBe("Test Todo");
    });

    it("should return 404 for non-existent UUID", async () => {
      const response = await request(app)
        .get("/todos/00000000-0000-1000-8000-000000000000")
        .expect(404);

      expect(response.body.error).toBe("Todo not found");
    });

    it("should return 400 for invalid ID format", async () => {
      const response = await request(app)
        .get("/todos/non-existent-id")
        .expect(400);

      expect(response.body.error).toContain("Invalid ID format");
    });
  });

  describe("PUT /todos/:id", () => {
    it("should update todo title", async () => {
      const createResponse = await request(app)
        .post("/todos")
        .send({ title: "Original Title" });

      const id = createResponse.body.id;

      const response = await request(app)
        .put(`/todos/${id}`)
        .send({ title: "Updated Title" })
        .expect(200);

      expect(response.body.title).toBe("Updated Title");
      expect(response.body.id).toBe(id);
    });

    it("should update todo description", async () => {
      const createResponse = await request(app)
        .post("/todos")
        .send({ title: "Test", description: "Original" });

      const id = createResponse.body.id;

      const response = await request(app)
        .put(`/todos/${id}`)
        .send({ description: "Updated" })
        .expect(200);

      expect(response.body.description).toBe("Updated");
      expect(response.body.title).toBe("Test");
    });

    it("should update todo completed status", async () => {
      const createResponse = await request(app)
        .post("/todos")
        .send({ title: "Test" });

      const id = createResponse.body.id;

      const response = await request(app)
        .put(`/todos/${id}`)
        .send({ completed: true })
        .expect(200);

      expect(response.body.completed).toBe(true);
    });

    it("should update multiple fields", async () => {
      const createResponse = await request(app)
        .post("/todos")
        .send({ title: "Original" });

      const id = createResponse.body.id;

      const response = await request(app)
        .put(`/todos/${id}`)
        .send({
          title: "Updated",
          description: "New description",
          completed: true,
        })
        .expect(200);

      expect(response.body.title).toBe("Updated");
      expect(response.body.description).toBe("New description");
      expect(response.body.completed).toBe(true);
    });

    it("should return 404 for non-existent UUID", async () => {
      const response = await request(app)
        .put("/todos/00000000-0000-1000-8000-000000000000")
        .send({ title: "Updated" })
        .expect(404);

      expect(response.body.error).toBe("Todo not found");
    });

    it("should return 400 for invalid ID format", async () => {
      const response = await request(app)
        .put("/todos/non-existent-id")
        .send({ title: "Updated" })
        .expect(400);

      expect(response.body.error).toContain("Invalid ID format");
    });

    it("should return 400 for empty update", async () => {
      const createResponse = await request(app)
        .post("/todos")
        .send({ title: "Test" });

      const id = createResponse.body.id;

      const response = await request(app)
        .put(`/todos/${id}`)
        .send({})
        .expect(400);

      expect(response.body.error).toContain(
        "At least one field must be provided",
      );
    });

    it("should return 400 for invalid title", async () => {
      const createResponse = await request(app)
        .post("/todos")
        .send({ title: "Test" });

      const id = createResponse.body.id;

      const response = await request(app)
        .put(`/todos/${id}`)
        .send({ title: "   " })
        .expect(400);

      expect(response.body.error).toContain("Title cannot be empty");
    });

    it("should return 400 for invalid completed value", async () => {
      const createResponse = await request(app)
        .post("/todos")
        .send({ title: "Test" });

      const id = createResponse.body.id;

      const response = await request(app)
        .put(`/todos/${id}`)
        .send({ completed: "true" })
        .expect(400);

      expect(response.body.error).toContain("Completed must be a boolean");
    });
  });

  describe("DELETE /todos/:id", () => {
    it("should delete todo", async () => {
      const createResponse = await request(app)
        .post("/todos")
        .send({ title: "Test" });

      const id = createResponse.body.id;

      await request(app).delete(`/todos/${id}`).expect(204);

      await request(app).get(`/todos/${id}`).expect(404);
    });

    it("should return 404 for non-existent UUID", async () => {
      const response = await request(app)
        .delete("/todos/00000000-0000-1000-8000-000000000000")
        .expect(404);

      expect(response.body.error).toBe("Todo not found");
    });

    it("should return 400 for invalid ID format", async () => {
      const response = await request(app)
        .delete("/todos/non-existent-id")
        .expect(400);

      expect(response.body.error).toContain("Invalid ID format");
    });

    it("should remove todo from list", async () => {
      const createResponse1 = await request(app)
        .post("/todos")
        .send({ title: "Todo 1" });

      await request(app).post("/todos").send({ title: "Todo 2" });

      await request(app)
        .delete(`/todos/${createResponse1.body.id}`)
        .expect(204);

      const response = await request(app).get("/todos").expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe("Todo 2");
    });
  });

  describe("Auth email normalization", () => {
    it("should normalize email for /auth/resend-verification", async () => {
      const mockAuthService = {
        getUserByEmail: jest.fn().mockResolvedValue({
          id: "user-1",
          isVerified: false,
        }),
        dispatchVerificationEmail: jest.fn(),
        sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
      } as any;

      const authApp = createApp({
        todoService: new TodoService(),
        authService: mockAuthService,
      });

      await request(authApp)
        .post("/auth/resend-verification")
        .send({ email: "  MiXeD@Example.COM  " })
        .expect(200);

      expect(mockAuthService.getUserByEmail).toHaveBeenCalledWith(
        "mixed@example.com",
      );
      expect(mockAuthService.dispatchVerificationEmail).toHaveBeenCalledWith(
        "user-1",
        "Failed to send verification email after resend request:",
      );
    });

    it("should normalize email for /auth/forgot-password", async () => {
      const mockAuthService = {
        requestPasswordReset: jest.fn().mockResolvedValue(undefined),
      } as any;

      const authApp = createApp({
        todoService: new TodoService(),
        authService: mockAuthService,
      });

      await request(authApp)
        .post("/auth/forgot-password")
        .send({ email: "  MiXeD@Example.COM  " })
        .expect(200);

      expect(mockAuthService.requestPasswordReset).toHaveBeenCalledWith(
        "mixed@example.com",
      );
    });
  });

  describe("Auth verification link responses", () => {
    it("should redirect browser requests to app after successful verification", async () => {
      const mockAuthService = {
        verifyEmail: jest.fn().mockResolvedValue(undefined),
      } as any;

      const authApp = createApp({
        todoService: new TodoService(),
        authService: mockAuthService,
      });

      await request(authApp)
        .get("/auth/verify")
        .set("Accept", "text/html")
        .query({ token: "verification-token" })
        .expect(303)
        .expect("Location", "/?verified=1");

      expect(mockAuthService.verifyEmail).toHaveBeenCalledWith(
        "verification-token",
      );
    });

    it("should redirect browser requests to app with failure marker on invalid token", async () => {
      const mockAuthService = {
        verifyEmail: jest.fn().mockRejectedValue(new Error("Invalid token")),
      } as any;

      const authApp = createApp({
        todoService: new TodoService(),
        authService: mockAuthService,
      });

      await request(authApp)
        .get("/auth/verify")
        .set("Accept", "text/html")
        .query({ token: "bad-token" })
        .expect(303)
        .expect("Location", "/?verified=0");
    });

    it("should keep JSON response for API clients", async () => {
      const mockAuthService = {
        verifyEmail: jest.fn().mockResolvedValue(undefined),
      } as any;

      const authApp = createApp({
        todoService: new TodoService(),
        authService: mockAuthService,
      });

      const response = await request(authApp)
        .get("/auth/verify")
        .set("Accept", "application/json")
        .query({ token: "verification-token" })
        .expect(200);

      expect(response.body).toEqual({ message: "Email verified successfully" });
    });
  });

  describe("Admin error handling", () => {
    it("returns centralized error shape for admin router failures", async () => {
      const mockAuthService = {
        verifyToken: jest
          .fn()
          .mockReturnValue({ userId: "admin-1", email: "admin@example.com" }),
        verifyActiveToken: jest.fn().mockResolvedValue({
          userId: "admin-1",
          email: "admin@example.com",
        }),
        isAdmin: jest.fn().mockResolvedValue(true),
        getAllUsers: jest.fn().mockRejectedValue({ code: "P2023" }),
      } as any;

      const authApp = createApp({
        todoService: new TodoService(),
        authService: mockAuthService,
      });

      const response = await request(authApp)
        .get("/admin/users")
        .set("Authorization", "Bearer test-token")
        .expect(400);

      expect(response.body).toEqual({ error: "Invalid ID format" });
    });
  });
});
