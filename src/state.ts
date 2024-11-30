import React from 'react';

import type { ExternalToast, PromiseData, PromiseT, ToastT, ToastTypes } from './types';
import EventEmitter from './emitter';


type titleT = (() => React.ReactNode) | React.ReactNode;

class Observer {
	subscribers: Array<(toast: ExternalToast) => void>;
	toasts: Array<ToastT>;

	constructor() {
		this.subscribers = [];
		this.toasts = [];
	}

	// We use arrow functions to maintain the correct `this` reference
	subscribe = (subscriber: (toast: ToastT) => void) => {
		this.subscribers.push(subscriber);

		return () => {
			const index = this.subscribers.indexOf(subscriber);
			this.subscribers.splice(index, 1);
		};
	};

	publish = (data: ToastT) => {
		this.subscribers.forEach((subscriber) => subscriber(data));
	};

	addToast = (data: ToastT) => {
		console.log(data);
		this.publish(data);
		this.toasts = [...this.toasts, data];
	};

	create = (
		data: ExternalToast & {
			message?: titleT;
			type?: ToastTypes;
			promise?: PromiseT;
			jsx?: React.ReactElement;
		},
	) => {
		const { message, ...rest } = data;
		const id = typeof data?.id === 'number' || data.id?.length > 0 ? data.id : crypto.randomUUID();
		const alreadyExists = this.toasts.find((toast) => {
			return toast.id === id;
		});
		const dismissible = data.dismissible === undefined ? true : data.dismissible;

		if (alreadyExists) {
			this.toasts = this.toasts.map((toast) => {
				if (toast.id === id) {
					this.publish({ ...toast, ...data, id, title: message });
					return {
						...toast,
						...data,
						id,
						dismissible,
						title: message,
					};
				}

				return toast;
			});
		} else {
			this.addToast({ title: message, ...rest, dismissible, id });
		}

		return id;
	};

	dismiss = (id?: number | string) => {
		if (!id) {
			this.toasts.forEach((toast) => {
				this.subscribers.forEach((subscriber) => subscriber({ ...toast, dismiss: true }));
			});
		}

		const toast = this.toasts.find(t => t.id === id);
		if (!toast) return false;

		this.subscribers.forEach((subscriber) => subscriber({ ...toast, dismiss: true }));

		return true;
	};

	message = (message: titleT | React.ReactNode, data?: ExternalToast) => {
		return this.create({ ...data, message });
	};

	error = (message: titleT | React.ReactNode, data?: ExternalToast) => {
		return this.create({ ...data, message, type: 'error' });
	};

	success = (message: titleT | React.ReactNode, data?: ExternalToast) => {
		return this.create({ ...data, type: 'success', message });
	};

	info = (message: titleT | React.ReactNode, data?: ExternalToast) => {
		return this.create({ ...data, type: 'info', message });
	};

	warning = (message: titleT | React.ReactNode, data?: ExternalToast) => {
		return this.create({ ...data, type: 'warning', message });
	};

	loading = (message: titleT | React.ReactNode, data?: ExternalToast) => {
		return this.create({ ...data, type: 'loading', message });
	};

	promise = <ToastData>(promise: PromiseT<ToastData>, data?: PromiseData<ToastData>) => {
		if (!data) {
			// Nothing to show
			return;
		}

		let id: string | number | undefined = undefined;
		if (data.loading !== undefined) {
			id = this.create({
				...data,
				promise,
				type: 'loading',
				message: data.loading,
				description: typeof data.description !== 'function' ? data.description : undefined,
			});
		}

		const p = promise instanceof Promise ? promise : promise();

		let shouldDismiss = id !== undefined;
		let result: ['resolve', ToastData] | ['reject', unknown];

		const originalPromise = p
			.then(async (response) => {
				result = ['resolve', response];
				const isReactElementResponse = React.isValidElement(response);
				if (isReactElementResponse) {
					shouldDismiss = false;
					this.create({ id, type: 'default', message: response, category: data.category });
				} else if (isHttpResponse(response) && !response.ok) {
					shouldDismiss = false;
					const message =
						typeof data.error === 'function' ? await data.error(`HTTP error! status: ${response.status}`) : data.error;
					const description =
						typeof data.description === 'function'
							? await data.description(`HTTP error! status: ${response.status}`)
							: data.description;
					this.create({ id, type: 'error', message, description, category: data.category });
				} else if (data.success !== undefined) {
					shouldDismiss = false;
					const message = typeof data.success === 'function' ? await data.success(response) : data.success;
					const description =
						typeof data.description === 'function' ? await data.description(response) : data.description;
					this.create({ id, type: 'success', message, description, category: data.category });
				}
			})
			.catch(async (error) => {
				result = ['reject', error];
				if (data.error !== undefined) {
					shouldDismiss = false;
					const message = typeof data.error === 'function' ? await data.error(error) : data.error;
					const description = typeof data.description === 'function' ? await data.description(error) : data.description;
					this.create({ id, type: 'error', message, description, category: data.category });
				}
			})
			.finally(() => {
				if (shouldDismiss) {
					// Toast is still in load state (and will be indefinitely — dismiss it)
					this.dismiss(id);
					id = undefined;
				}

				data.finally?.();
			});

		const unwrap = () =>
			new Promise<ToastData>((resolve, reject) =>
				originalPromise.then(() => (result[0] === 'reject' ? reject(result[1]) : resolve(result[1]))).catch(reject),
			);

		if (typeof id !== 'string' && typeof id !== 'number') {
			// cannot Object.assign on undefined
			return { unwrap };
		} else {
			return Object.assign(id, { unwrap });
		}
	};

	custom = (jsx: (id: number | string) => React.ReactElement, data?: ExternalToast) => {
		const id = data?.id || crypto.randomUUID();
		this.create({ jsx: jsx(id), id, ...data });
		return id;
	};
}

export const Events = new EventEmitter();
export const CategoryStates = new Map<PropertyKey, Observer>();
export const DEFAULT_CATEGORY = Symbol.for('sonner.default');

// bind this to the toast function
export const toast = (message: titleT, data?: ExternalToast) => {
	const id = data?.id || crypto.randomUUID();

	data.category ??= DEFAULT_CATEGORY;

	if (!CategoryStates.has(data.category)) {
		CategoryStates.set(data.category, new Observer());

		Events.emit('add-category', data.category);
	}

	const category = CategoryStates.get(data.category);
	const method = category[data.type ?? 'addToast'].bind(category);

	method({
		title: message,
		...data,
		id,
	});

	return id;
};

export const dismissToast = (id: ExternalToast['id'], category?: PropertyKey): boolean => {
	const observer = CategoryStates.get(category);
	if (!observer) return false;

	observer.dismiss(id);

	return true;
};

const isHttpResponse = (data: any): data is Response => {
	return (
		data &&
		typeof data === 'object' &&
		'ok' in data &&
		typeof data.ok === 'boolean' &&
		'status' in data &&
		typeof data.status === 'number'
	);
};