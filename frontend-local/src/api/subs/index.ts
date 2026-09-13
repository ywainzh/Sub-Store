import request from '@/api';
import { AxiosPromise } from 'axios';

export function useSubsApi() {
  return {
    getStatuses: (): AxiosPromise<MyAxiosRes> => request({ url: '/api/subs/status', method: 'get' }),
    checkAvailability: (name: string): AxiosPromise<MyAxiosRes> => request({
      url: `/api/sub/${encodeURIComponent(name)}/check`, method: 'post',
    }),
    setAvailability: (type: 'sub' | 'collection', name: string, enabled: boolean): AxiosPromise<MyAxiosRes> => request({
      url: `/api/${type}/${encodeURIComponent(name)}`, method: 'patch', data: { enabled },
    }),
    getSubs: (): AxiosPromise<MyAxiosRes> => {
      return request({
        url: '/api/subs',
        method: 'get',
      });
    },
    getCollections: (): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/collections`,
        method: 'get',
      });
    },
    getOne: (type: string, name: string): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/${type}/${encodeURIComponent(name)}`,
        method: 'get',
      });
    },
    exportOne: (type: 'sub' | 'collection', name: string): AxiosPromise<Blob> => {
      return request({
        url: `/api/${type}/${encodeURIComponent(name)}`,
        method: 'get',
        params: { raw: 1 },
        responseType: 'blob',
      });
    },
    downloadOne: (name: string, params?: any): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/download/${encodeURIComponent(name)}`,
        params,
        method: 'get',
      });
    },
    getFlow: (name: string, signal?: AbortSignal): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/sub/flow/${encodeURIComponent(name)}`,
        method: 'get',
        signal,
      });
    },
    getSubInfo: (data: NodeInfo): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/utils/node-info`,
        method: 'post',
        data,
      });
    },
    createSub: (
      type: string,
      data: Sub | Collection,
    ): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/${type}`,
        method: 'post',
        data,
      });
    },
    editSub: (
      type: string,
      name: string,
      data: Sub | Collection
    ): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/${type}/${encodeURIComponent(name)}`,
        method: 'patch',
        data,
      });
    },
    deleteSub: (
      type: string,
      name: string,
    ): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/${type}/${encodeURIComponent(name)}`,
        method: 'delete',
      });
    },
    compareSub: (
      type: string,
      data: Sub | Collection | any
    ): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/preview/${type}`,
        method: 'post',
        data,
      });
    },
    sortSub: (
      type: string,
      data: Sub | Collection | Artifacts
    ): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/${type}`,
        method: 'put',
        data,
      });
    },
    newSortSub: (
      type: string,
      data: Sub | Collection | Artifacts
    ): AxiosPromise<MyAxiosRes> => {
      return request({
        url: `/api/sort/${type}`,
        method: 'post',
        data,
      });
    },
  };
}
