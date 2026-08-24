export class RingBuffer<T> {
	private items: T[] = [];

	constructor(private readonly capacity: number) {}

	push(item: T): void {
		this.items.push(item);
		if (this.items.length > this.capacity) {
			this.items.shift();
		}
	}

	get size(): number {
		return this.items.length;
	}

	snapshot(): T[] {
		return [...this.items];
	}

	clear(): void {
		this.items = [];
	}
}
