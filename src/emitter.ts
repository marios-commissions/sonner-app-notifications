class EventEmitter {
	#listeners: Record<string, Set<(...args: any[]) => any>> = {};

	emit(event: string, payload: any = null) {
		if (!this.#listeners[event]) return;

		for (const callbacks of this.#listeners[event]) {
			try {
				callbacks(payload);
			} catch (e) {
				console.error(`Failed to fire event listener for ${event}:`, e.message);
			}
		}
	}

	on(event: string, callback: (...args: any[]) => any) {
		this.addListener(event, callback);
	}

	off(event: string, callback: (...args: any[]) => any) {
		this.removeListener(event, callback);
	}

	addListener(event: string, callback: (...args: any[]) => any) {
		this.#listeners[event] ??= new Set();
		this.#listeners[event].add(callback);
	}

	removeListener(event: string, callback: (...args: any[]) => any) {
		if (!this.#listeners[event]) return;

		this.#listeners[event].delete(callback);

		if (!this.#listeners[event].size) {
			delete this.#listeners[event];
		};
	}
}

export default EventEmitter;