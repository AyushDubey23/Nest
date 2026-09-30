import { renderHook, waitFor, act } from '@testing-library/react'
import { useSearchPage } from 'hooks/useSearchPage'
import { useRouter, useSearchParams } from 'next/navigation'
import React from 'react'
import { fetchAlgoliaData } from 'server/fetchAlgoliaData'

jest.mock('server/fetchAlgoliaData', () => ({
  fetchAlgoliaData: jest.fn(),
}))

jest.mock('app/global-error', () => ({
  handleAppError: jest.fn(),
}))

const mockFetchAlgoliaData = fetchAlgoliaData as jest.Mock
const mockUseSearchParams = useSearchParams as jest.Mock
const mockUseRouter = useRouter as jest.Mock

const defaultOptions = {
  indexName: 'projects',
  pageTitle: 'OWASP Projects',
  defaultSortBy: 'default',
  defaultOrder: 'desc',
} as const

describe('useSearchPage', () => {
  const push = jest.fn()

  const renderSearchPage = async (
    queryString = '',
    options: {
      facetFilters?: string[]
      indexName?: string
      pageTitle?: string
      wrapper?: React.ComponentType<{ children: React.ReactNode }>
    } = {}
  ) => {
    const { facetFilters, indexName, pageTitle, wrapper } = options
    mockUseSearchParams.mockReturnValue(new URLSearchParams(queryString))

    const rendered = renderHook(
      () =>
        useSearchPage({
          ...defaultOptions,
          ...(indexName ? { indexName } : {}),
          ...(pageTitle ? { pageTitle } : {}),
          ...(facetFilters ? { facetFilters } : {}),
        }),
      wrapper ? { wrapper } : undefined
    )

    await waitFor(() => {
      expect(rendered.result.current.isLoaded).toBe(true)
    })

    return rendered
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockUseRouter.mockReturnValue({ push })
    mockFetchAlgoliaData.mockResolvedValue({
      hits: [{ objectID: '1' }],
      totalPages: 5,
    })
  })

  it('preserves the page query param on initial load', async () => {
    const { result } = await renderSearchPage('page=3')

    expect(result.current.currentPage).toBe(3)
    expect(mockFetchAlgoliaData).toHaveBeenCalledWith('projects', '', 3, undefined, [])
    expect(push).not.toHaveBeenCalled()
  })

  it('preserves the page query param under Strict Mode double effects', async () => {
    const { result } = await renderSearchPage('page=3', { wrapper: React.StrictMode })

    expect(result.current.currentPage).toBe(3)
    expect(mockFetchAlgoliaData).toHaveBeenCalledWith('projects', '', 3, undefined, [])
    expect(push).not.toHaveBeenCalled()
  })

  it('resets to page 1 when facet filters change after mount', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('page=3'))

    const { result, rerender } = renderHook(
      ({ facetFilters }) =>
        useSearchPage({
          indexName: 'chapters',
          pageTitle: 'OWASP Chapters',
          defaultSortBy: 'default',
          defaultOrder: 'desc',
          facetFilters,
        }),
      { initialProps: { facetFilters: [] as string[] } }
    )

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true)
      expect(result.current.currentPage).toBe(3)
    })

    mockUseSearchParams.mockReturnValue(new URLSearchParams())

    rerender({ facetFilters: ['idx_country:US'] })

    await waitFor(() => {
      expect(result.current.currentPage).toBe(1)
    })
  })

  it('resets to page 1 when the search query changes', async () => {
    const { result } = await renderSearchPage('page=3')

    act(() => {
      result.current.handleSearch('owasp')
    })

    expect(result.current.currentPage).toBe(1)

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true)
      expect(mockFetchAlgoliaData).toHaveBeenCalledWith('projects', 'owasp', 1, undefined, [])
    })
  })

  it('resets to page 1 when the sort option changes', async () => {
    const { result } = await renderSearchPage('page=3')

    act(() => {
      result.current.handleSortChange('stars_count')
    })

    expect(result.current.currentPage).toBe(1)
    expect(result.current.sortBy).toBe('stars_count')

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true)
      expect(mockFetchAlgoliaData).toHaveBeenCalledWith(
        'projects_stars_count_desc',
        '',
        1,
        undefined,
        []
      )
    })
  })

  it('resets to page 1 when the sort order changes', async () => {
    const { result } = await renderSearchPage('page=3&sortBy=stars_count&order=desc')

    expect(result.current.currentPage).toBe(3)
    expect(result.current.sortBy).toBe('stars_count')

    act(() => {
      result.current.handleOrderChange('asc')
    })

    expect(result.current.currentPage).toBe(1)
    expect(result.current.order).toBe('asc')

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true)
      expect(mockFetchAlgoliaData).toHaveBeenCalledWith(
        'projects_stars_count_asc',
        '',
        1,
        undefined,
        []
      )
    })
  })

  it('synchronizes state from URL on back/forward without pushing', async () => {
    const { result, rerender } = await renderSearchPage('page=3')

    push.mockClear()
    mockUseSearchParams.mockReturnValue(new URLSearchParams('page=2&q=nest'))
    rerender()

    await waitFor(() => {
      expect(result.current.currentPage).toBe(2)
      expect(result.current.searchQuery).toBe('nest')
    })

    expect(push).not.toHaveBeenCalled()
  })

  it('does not push when back/forward lands on an equivalent page=1 URL', async () => {
    const { result, rerender } = await renderSearchPage('page=2&q=foo')

    push.mockClear()
    mockUseSearchParams.mockReturnValue(new URLSearchParams('page=1&q=foo'))
    rerender()

    await waitFor(() => {
      expect(result.current.currentPage).toBe(1)
      expect(result.current.searchQuery).toBe('foo')
    })

    expect(push).not.toHaveBeenCalled()
  })

  it('falls back to page 1 for non-numeric or non-positive page params', async () => {
    const { result, rerender } = await renderSearchPage('page=abc')

    expect(result.current.currentPage).toBe(1)
    expect(mockFetchAlgoliaData).toHaveBeenCalledWith('projects', '', 1, undefined, [])

    mockUseSearchParams.mockReturnValue(new URLSearchParams('page=0'))
    rerender()

    await waitFor(() => {
      expect(result.current.currentPage).toBe(1)
    })

    mockUseSearchParams.mockReturnValue(new URLSearchParams('page=-2'))
    rerender()

    await waitFor(() => {
      expect(result.current.currentPage).toBe(1)
    })
  })

  it('still pushes URL updates for user-driven page changes after back/forward sync', async () => {
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    try {
      const { result, rerender } = await renderSearchPage('page=3')

      push.mockClear()
      mockUseSearchParams.mockReturnValue(new URLSearchParams('page=2'))
      rerender()

      await waitFor(() => {
        expect(result.current.currentPage).toBe(2)
      })
      expect(push).not.toHaveBeenCalled()

      act(() => {
        result.current.handlePageChange(4)
      })

      expect(result.current.currentPage).toBe(4)
      expect(scrollTo).toHaveBeenCalled()
      await waitFor(() => {
        expect(push).toHaveBeenCalledWith('?page=4')
      })
    } finally {
      scrollTo.mockRestore()
    }
  })

  it('applies back/forward after a local navigation is acknowledged', async () => {
    const { result, rerender } = await renderSearchPage('page=2')

    act(() => {
      result.current.handleSearch('nest')
    })

    expect(result.current.searchQuery).toBe('nest')
    expect(result.current.currentPage).toBe(1)

    mockUseSearchParams.mockReturnValue(new URLSearchParams('q=nest'))
    rerender()

    push.mockClear()
    mockUseSearchParams.mockReturnValue(new URLSearchParams('page=2'))
    rerender()

    await waitFor(() => {
      expect(result.current.currentPage).toBe(2)
      expect(result.current.searchQuery).toBe('')
    })
    expect(push).not.toHaveBeenCalled()
  })

  it('applies back/forward when it happens before a local push is acknowledged', async () => {
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    try {
      const { result, rerender } = await renderSearchPage('page=2')

      act(() => {
        result.current.handlePageChange(4)
      })
      expect(result.current.currentPage).toBe(4)
      expect(push).toHaveBeenCalledWith('?page=4')

      push.mockClear()
      mockUseSearchParams.mockReturnValue(new URLSearchParams('page=2'))
      rerender()

      await waitFor(() => {
        expect(result.current.currentPage).toBe(2)
      })
      expect(push).not.toHaveBeenCalled()
    } finally {
      scrollTo.mockRestore()
    }
  })

  it('still pushes after a no-op sync from noncanonical default sort params', async () => {
    const { result, rerender } = await renderSearchPage('')

    push.mockClear()
    mockUseSearchParams.mockReturnValue(new URLSearchParams('sortBy=default&order=desc'))
    rerender()

    expect(result.current.sortBy).toBe('default')
    expect(result.current.order).toBe('desc')
    expect(push).not.toHaveBeenCalled()

    act(() => {
      result.current.handleSearch('nest')
    })

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('?q=nest')
    })
  })

  it('ignores stale responses when rapidly changing pages', async () => {
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    try {
      let resolvePage2!: (value: unknown) => void
      let resolvePage3!: (value: unknown) => void

      const page2Promise = new Promise((resolve) => {
        resolvePage2 = resolve
      })
      const page3Promise = new Promise((resolve) => {
        resolvePage3 = resolve
      })

      const { result } = await renderSearchPage('page=1')

      mockFetchAlgoliaData.mockReturnValueOnce(page2Promise).mockReturnValueOnce(page3Promise)

      act(() => {
        result.current.handlePageChange(2)
      })

      act(() => {
        result.current.handlePageChange(3)
      })

      // Newer request (page 3) resolves first
      await act(async () => {
        resolvePage3({
          hits: [{ objectID: 'page-3' }],
          totalPages: 5,
        })
      })

      expect(result.current.items).toEqual([{ objectID: 'page-3' }])

      // Slower, older request (page 2) resolves after
      await act(async () => {
        resolvePage2({
          hits: [{ objectID: 'page-2' }],
          totalPages: 5,
        })
      })

      // Stale results must not overwrite current page
      expect(result.current.items).toEqual([{ objectID: 'page-3' }])
    } finally {
      scrollTo.mockRestore()
    }
  })

  it('ignores stale errors when a newer request is already in flight', async () => {
    const scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    try {
      const { handleAppError } = jest.requireMock('app/global-error')
      let rejectPage2!: (error: unknown) => void
      let resolvePage3!: (value: unknown) => void

      const page2Promise = new Promise((_, reject) => {
        rejectPage2 = reject
      })
      const page3Promise = new Promise((resolve) => {
        resolvePage3 = resolve
      })

      const { result } = await renderSearchPage('page=1')

      mockFetchAlgoliaData.mockReturnValueOnce(page2Promise).mockReturnValueOnce(page3Promise)

      act(() => {
        result.current.handlePageChange(2)
      })

      act(() => {
        result.current.handlePageChange(3)
      })

      await act(async () => {
        resolvePage3({
          hits: [{ objectID: 'page-3' }],
          totalPages: 5,
        })
      })

      await act(async () => {
        rejectPage2(new Error('Network error on old request'))
      })

      expect(handleAppError).not.toHaveBeenCalled()
      expect(result.current.items).toEqual([{ objectID: 'page-3' }])
    } finally {
      scrollTo.mockRestore()
    }
  })
})
