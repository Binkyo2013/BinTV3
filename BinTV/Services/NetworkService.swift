import Foundation
import Combine

class NetworkService: ObservableObject {
    static let baseURL = "https://api.bittv.app/v1"

    func fetchJSON<T: Decodable>(_ urlString: String) async throws -> T {
        guard let url = URL(string: urlString) else { throw URLError(.badURL) }
        let (data, _) = try await URLSession.shared.data(from: url)
        return try JSONDecoder().decode(T.self, from: data)
    }
}
