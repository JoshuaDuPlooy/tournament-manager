import tkinter as tk
import random


class RandomNumberApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Random Number Picker")

        self.vars = []
        self.seed_var = tk.StringVar()

        self.build_ui()

    def build_ui(self):
        tk.Label(self.root, text="Select Available Numbers (1–16):").pack()

        frame = tk.Frame(self.root)
        frame.pack()

        for i in range(1, 17):
            var = tk.IntVar()
            cb = tk.Checkbutton(frame, text=str(i), variable=var)
            cb.grid(row=(i - 1) // 4, column=(i - 1) % 4, sticky="w")
            self.vars.append((i, var))

        tk.Label(self.root, text="Optional Seed (integer):").pack(pady=(10, 0))
        tk.Entry(self.root, textvariable=self.seed_var).pack()

        self.result_label = tk.Label(self.root, text="Result: ")
        self.result_label.pack(pady=10)

        tk.Button(
            self.root,
            text="Get Random Number",
            command=self.get_random
        ).pack(pady=5)

    def get_random(self):
        seed_value = self.seed_var.get().strip()

        if seed_value != "":
            try:
                random.seed(int(seed_value))
            except ValueError:
                self.result_label.config(text="Result: Invalid seed")
                return

        selected = [num for num, var in self.vars if var.get() == 1]

        if not selected:
            self.result_label.config(text="Result: No numbers selected")
            return

        self.result_label.config(
            text=f"Result: {random.choice(selected)}"
        )


if __name__ == "__main__":
    root = tk.Tk()
    app = RandomNumberApp(root)
    root.mainloop()